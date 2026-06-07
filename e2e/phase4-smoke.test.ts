/**
 * Phase 4 E2E: Multi-Agent Delegation
 *
 * Acceptance criteria:
 *   Given  a coder Agent and a reviewer Agent
 *   When   user says "write a function, then have the reviewer review it"
 *   Then   - coder generates code
 *          - coder calls delegate_to_reviewer tool
 *          - reviewer receives code, reviews it, returns result
 *          - OTel Trace tree contains both Agent spans (parent-child)
 *          - costs are correctly attributed to parent agent
 *
 * Uses mock LLM + real AgentRegistry + real AgentRouter + real Harness.
 *
 * Run: npx vitest run e2e/phase4-smoke.test.ts
 */
import { describe, it, expect, beforeEach } from "vitest";
import { AgentContext, SessionContext } from "../packages/core/src/context.js";
import { AgentRegistry } from "../packages/core/src/agent-registry.js";
import { AgentRouter } from "../packages/core/src/agent-router.js";
import { HandlerEngine } from "../packages/core/src/handler-engine.js";
import { Harness } from "../packages/core/src/harness.js";
import { CostAttributionTracker } from "../packages/core/src/cost-tracker.js";
import { registerOTelBridge } from "../packages/core/src/otel/index.js";
import { createInMemoryStore } from "../packages/core/src/checkpoint-store.js";
import type {
  LLMProvider,
  LLMResponse,
  LLMMessage,
  Tool,
  ToolDefinition,
  ToolResult,
  ToolContext,
  DelegationRequest,
} from "../packages/core/src/types.js";
import type { ProteusTracer, ProteusSpan, ProteusMetric } from "../packages/core/src/otel/types.js";

// ============================================================
// Mock Tracer — records spans and parent-child relationships
// ============================================================

let spanCounter = 0;

class MockSpan implements ProteusSpan {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly startTime: number;
  readonly parent?: MockSpan;
  readonly attributes: Record<string, string | number | boolean> = {};
  private _status?: { code: "ok" | "error"; message?: string };
  private _ended = false;

  constructor(name: string, parent?: MockSpan, attributes?: Record<string, string | number | boolean>) {
    this.name = name;
    this.parent = parent;
    this.spanId = `span-${++spanCounter}`;
    this.traceId = parent?.traceId ?? `trace-${spanCounter}`;
    this.startTime = Date.now();
    if (attributes) Object.assign(this.attributes, attributes);
  }

  setAttribute(key: string, value: string | number | boolean): void {
    this.attributes[key] = value;
  }

  setStatus(code: "ok" | "error", message?: string): void {
    this._status = { code, message };
  }

  end(): void {
    this._ended = true;
  }

  get ended(): boolean { return this._ended; }
  get status() { return this._status; }
}

class MockTracer implements ProteusTracer {
  readonly spans: MockSpan[] = [];
  private activeSpan?: MockSpan;

  startSpan(name: string, parent?: ProteusSpan, attributes?: Record<string, string | number | boolean>): ProteusSpan {
    const span = new MockSpan(name, parent as MockSpan | undefined, attributes);
    this.spans.push(span);
    this.activeSpan = span;
    return span;
  }

  getActiveSpan(): ProteusSpan | undefined {
    return this.activeSpan;
  }

  getSpansByName(name: string): MockSpan[] {
    return this.spans.filter(s => s.name === name);
  }
}

class MockMetric implements ProteusMetric {
  readonly counters = new Map<string, number>();
  readonly histograms: Array<{ name: string; value: number }> = [];

  incrementCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  recordHistogram(name: string, value: number): void {
    this.histograms.push({ name, value });
  }

  setGauge(_name: string, _value: number): void {}
}

// ============================================================
// Mock LLM factories
// ============================================================

function textResponse(content: string): LLMResponse {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5 },
    finishReason: "stop",
  };
}

function toolCallResponse(toolCalls: LLMResponse["toolCalls"]): LLMResponse {
  return {
    content: "",
    toolCalls,
    usage: { promptTokens: 15, completionTokens: 8 },
    finishReason: "tool_call",
  };
}

/**
 * Coder mock LLM:
 *   Call 1: returns tool call to delegate_to_reviewer
 *   Call 2: receives review tool result, returns final text
 *
 * The LLM's chatStream is what the Harness actually calls.
 * We queue responses so each invocation pops the next one.
 */
function createCoderMockLLM(): LLMProvider {
  let callIndex = 0;
  const responses: LLMResponse[] = [
    // Call 1: delegate to reviewer
    toolCallResponse([{
      id: "tc-code-1",
      name: "delegate_to_reviewer",
      arguments: {
        task: "Review this bubble sort:\nfunction bubbleSort(arr) {\n  for (let i = 0; i < arr.length; i++)\n    for (let j = 0; j < arr.length - i - 1; j++)\n      if (arr[j] > arr[j+1]) [arr[j], arr[j+1]] = [arr[j+1], arr[j]];\n  return arr;\n}",
      },
    }]),
    // Call 2: final answer after tool result
    textResponse("I wrote a bubble sort and the reviewer approved it with suggestions."),
  ];

  return {
    async chat(_messages: LLMMessage[], _tools: ToolDefinition[]): Promise<LLMResponse> {
      return responses[callIndex++] ?? responses[responses.length - 1];
    },
    async *chatStream(_messages: LLMMessage[], _tools: ToolDefinition[]): AsyncIterable<LLMResponse> {
      yield responses[callIndex++] ?? responses[responses.length - 1];
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}

/**
 * Reviewer mock LLM: single call — reviews code and returns feedback.
 */
function createReviewerMockLLM(): LLMProvider {
  return {
    async chat(_messages: LLMMessage[], _tools: ToolDefinition[]): Promise<LLMResponse> {
      return textResponse("Review: APPROVED. Suggestions: add input validation, consider early termination.");
    },
    async *chatStream(_messages: LLMMessage[], _tools: ToolDefinition[]): AsyncIterable<LLMResponse> {
      yield textResponse("Review: APPROVED. Suggestions: add input validation, consider early termination.");
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}

// ============================================================
// Agent-as-Tool: wraps a reviewer Agent as a callable Tool
// ============================================================

/**
 * Creates a Tool that delegates to a target agent via AgentRouter.
 * When the coder LLM calls "delegate_to_reviewer", this tool:
 *   1. Builds a DelegationRequest
 *   2. Calls AgentRouter.delegate()
 *   3. Returns the reviewer's response as the tool output
 */
function createAgentAsTool(params: {
  toolName: string;
  description: string;
  targetAgentId: string;
  router: AgentRouter;
  fromAgentId: string;
}): Tool {
  return {
    definition: {
      name: params.toolName,
      description: params.description,
      parameters: {
        type: "object",
        properties: {
          task: {
            type: "string",
            description: "The task to delegate to the reviewer agent",
          },
        },
        required: ["task"],
      },
    },
    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
      const task = String(args.task ?? "");
      const request: DelegationRequest = {
        fromAgentId: params.fromAgentId,
        toAgentId: params.targetAgentId,
        task,
      };

      const result = await params.router.delegate(request);

      if (!result.ok) {
        return {
          output: null,
          error: { message: result.reason, retryable: false },
        };
      }

      return {
        output: result.result.ok
          ? `Reviewer completed in ${result.result.duration}ms`
          : `Reviewer failed: ${result.result.error}`,
      };
    },
  };
}

// ============================================================
// Helpers
// ============================================================

function makeAgentContext(llm: LLMProvider, tools: Map<string, Tool> = new Map()): AgentContext {
  return new AgentContext({ llm, tools, handlerEngine: new HandlerEngine() });
}

// ============================================================
// Tests
// ============================================================

describe("Phase 4: Multi-Agent Delegation", () => {
  let registry: AgentRegistry;
  let tracer: MockTracer;
  let metric: MockMetric;
  let costTracker: CostAttributionTracker;

  beforeEach(() => {
    spanCounter = 0;
    registry = new AgentRegistry();
    tracer = new MockTracer();
    metric = new MockMetric();
    costTracker = new CostAttributionTracker();
  });

  // ----- Test 1: Full delegation flow via agent-as-tool -----

  it("coder delegates to reviewer via agent-as-tool and gets review result", async () => {
    const reviewer = makeAgentContext(createReviewerMockLLM());
    const router = new AgentRouter(registry, tracer, costTracker);

    const delegateTool = createAgentAsTool({
      toolName: "delegate_to_reviewer",
      description: "Delegate a code review task to the reviewer agent",
      targetAgentId: "reviewer",
      router,
      fromAgentId: "coder",
    });

    const coderTools = new Map<string, Tool>();
    coderTools.set("delegate_to_reviewer", delegateTool);
    const coder = makeAgentContext(createCoderMockLLM(), coderTools);

    registry.register("coder", coder);
    registry.register("reviewer", reviewer);

    // Run coder's turn through the real Harness
    const store = createInMemoryStore();
    const harness = new Harness({ store });
    const session = new SessionContext({
      sessionId: "coder-session",
      llm: { provider: "mock", model: "mock-1", temperature: 0 },
      tools: {},
      logLevel: "info",
    });
    session.workingMemory.push({
      role: "user",
      content: "Write a function, then have the reviewer review it",
    });

    const turnResult = await harness.runTurn(session, coder);

    expect(turnResult.status).toBe("completed");

    // The delegation span should exist (created by AgentRouter)
    const delegationSpans = tracer.getSpansByName("delegation");
    expect(delegationSpans.length).toBeGreaterThanOrEqual(1);

    const span = delegationSpans[0];
    expect(span.attributes["delegation.from"]).toBe("coder");
    expect(span.attributes["delegation.to"]).toBe("reviewer");
    expect(span.ended).toBe(true);
    expect(span.status?.code).toBe("ok");
  });

  // ----- Test 2: OTel parent-child span relationship -----

  it("OTel trace tree has parent-child span relationship", async () => {
    const reviewer = makeAgentContext(createReviewerMockLLM());
    const router = new AgentRouter(registry, tracer, costTracker);

    registry.register("coder", makeAgentContext(createCoderMockLLM()));
    registry.register("reviewer", reviewer);

    // Simulate a parent "turn" span
    const turnSpan = tracer.startSpan("turn", undefined, {
      "turn.id": "turn-1",
      "session.id": "coder-session",
    });

    // Direct delegation call — the router creates a delegation span as child of active span
    const result = await router.delegate({
      fromAgentId: "coder",
      toAgentId: "reviewer",
      task: "Review this code: function add(a,b) { return a+b; }",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.ok).toBe(true);
    }

    // 2 spans: the turn span + the delegation span
    expect(tracer.spans).toHaveLength(2);

    const delegationSpan = tracer.spans[1];
    expect(delegationSpan.name).toBe("delegation");

    // Parent-child: delegation span's parent is the turn span
    expect(delegationSpan.parent).toBe(turnSpan);

    // Same traceId
    expect(delegationSpan.traceId).toBe(turnSpan.traceId);

    expect(delegationSpan.ended).toBe(true);
    expect(delegationSpan.status?.code).toBe("ok");
  });

  // ----- Test 3: Delegation span attributes -----

  it("delegation span contains correct attributes", async () => {
    const reviewer = makeAgentContext(createReviewerMockLLM());
    const router = new AgentRouter(registry, tracer, costTracker);

    registry.register("coder", makeAgentContext(createCoderMockLLM()));
    registry.register("reviewer", reviewer);

    await router.delegate({
      fromAgentId: "coder",
      toAgentId: "reviewer",
      task: "Review the sorting function",
    });

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];

    expect(span.attributes["agent.id"]).toBe("coder");
    expect(span.attributes["agent.name"]).toBe("coder");
    expect(span.attributes["delegation.from"]).toBe("coder");
    expect(span.attributes["delegation.to"]).toBe("reviewer");
    expect(span.attributes["delegation.task"]).toBe("Review the sorting function");
  });

  // ----- Test 4: Cost attribution -----

  it("costs are correctly attributed to parent agent", async () => {
    const reviewer = makeAgentContext(createReviewerMockLLM());
    const router = new AgentRouter(registry, tracer, costTracker);

    registry.register("coder", makeAgentContext(createCoderMockLLM()));
    registry.register("reviewer", reviewer);

    await router.delegate({
      fromAgentId: "coder",
      toAgentId: "reviewer",
      task: "Review this code",
    });

    const allEntries = costTracker.getAllEntries();
    expect(allEntries.length).toBeGreaterThanOrEqual(1);

    // Reviewer's cost entry should have parentAgentId = "coder"
    const reviewerEntry = allEntries.find(e => e.agentId === "reviewer");
    expect(reviewerEntry).toBeDefined();
    expect(reviewerEntry!.parentAgentId).toBe("coder");
    expect(reviewerEntry!.tokens).toBeGreaterThan(0);
    expect(reviewerEntry!.cost).toBeGreaterThan(0);

    // Total cost for coder includes reviewer's cost (recursive via parentAgentId chain)
    const coderTotal = costTracker.getTotalCost("coder");
    expect(coderTotal).toBeGreaterThan(0);
    expect(coderTotal).toBe(reviewerEntry!.cost);
  });

  // ----- Test 5: Error handling — span ends with error -----

  it("delegation span ends with error on failure", async () => {
    const brokenLLM: LLMProvider = {
      async chat() { throw new Error("LLM service unavailable"); },
      async *chatStream() { throw new Error("LLM service unavailable"); },
      countTokens() { return 0; },
    };

    const reviewer = makeAgentContext(brokenLLM);
    registry.register("coder", makeAgentContext(createCoderMockLLM()));
    registry.register("reviewer", reviewer);

    const router = new AgentRouter(registry, tracer, costTracker);

    const result = await router.delegate({
      fromAgentId: "coder",
      toAgentId: "reviewer",
      task: "Review this code",
    });

    // Router returns ok:true with failed DelegationResult
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBeDefined();
    }

    expect(tracer.spans).toHaveLength(1);
    const span = tracer.spans[0];
    expect(span.ended).toBe(true);
    expect(span.status?.code).toBe("error");
    expect(span.attributes["error.message"]).toBeDefined();
  });

  // ----- Test 6: AgentRegistry CRUD -----

  it("AgentRegistry correctly manages multiple agents", () => {
    registry.register("coder", makeAgentContext(createCoderMockLLM()));
    registry.register("reviewer", makeAgentContext(createReviewerMockLLM()));

    expect(registry.list()).toEqual(["coder", "reviewer"]);
    expect(registry.get("coder")).toBeDefined();
    expect(registry.get("reviewer")).toBeDefined();
    expect(registry.has("coder")).toBe(true);
    expect(registry.has("reviewer")).toBe(true);
    expect(registry.has("unknown")).toBe(false);
  });

  // ----- Test 7: Delegation events emitted on fromAgent's engine -----

  it("delegation emits delegation:start and delegation:end events", async () => {
    const emittedEvents: string[] = [];

    // The router emits events on fromAgent's handlerEngine
    const coderEngine = new HandlerEngine();
    coderEngine.observe("delegation:start", async (_ctx: unknown) => {
      emittedEvents.push("delegation:start");
      return { ok: true };
    }, 0, "start-observer");
    coderEngine.observe("delegation:end", async (_ctx: unknown) => {
      emittedEvents.push("delegation:end");
      return { ok: true };
    }, 0, "end-observer");

    const coder = new AgentContext({
      llm: createCoderMockLLM(),
      tools: new Map<string, Tool>(),
      handlerEngine: coderEngine,
    });
    const reviewer = makeAgentContext(createReviewerMockLLM());

    registry.register("coder", coder);
    registry.register("reviewer", reviewer);

    const router = new AgentRouter(registry, tracer);

    await router.delegate({
      fromAgentId: "coder",
      toAgentId: "reviewer",
      task: "Review this code",
    });

    expect(emittedEvents).toContain("delegation:start");
    expect(emittedEvents).toContain("delegation:end");
  });

  // ----- Test 8: OTel bridge creates delegation metrics -----

  it("OTelBridgeHandler creates delegation metrics", async () => {
    // Register OTel bridge on coder's engine so delegation events are observed
    const coderEngine = new HandlerEngine();
    registerOTelBridge(coderEngine, tracer, metric);

    const coder = new AgentContext({
      llm: createCoderMockLLM(),
      tools: new Map<string, Tool>(),
      handlerEngine: coderEngine,
    });
    const reviewer = makeAgentContext(createReviewerMockLLM());

    registry.register("coder", coder);
    registry.register("reviewer", reviewer);

    const router = new AgentRouter(registry, tracer, costTracker);

    await router.delegate({
      fromAgentId: "coder",
      toAgentId: "reviewer",
      task: "Code review",
    });

    expect(metric.counters.get("proteus.delegation.total")).toBe(1);
    expect(metric.counters.get("proteus.delegation.completed")).toBe(1);
  });
});
