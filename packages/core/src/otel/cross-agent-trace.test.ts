import { describe, it, expect, beforeEach } from "vitest";
import type { ProteusSpan, ProteusTracer, ProteusMetric } from "./types.js";
import { OTelBridgeHandler, createOTelBridgeHandlers } from "./otel-bridge.js";
import { AgentRouter } from "../agent-router.js";
import { AgentRegistry } from "../agent-registry.js";
import { AgentContext } from "../context.js";
import { HandlerEngine } from "../handler-engine.js";
import type { LLMProvider, Tool } from "../types.js";

// --- Mock tracer that records parent-child relationships ---

interface RecordedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  parent?: RecordedSpan;
  status?: { code: "ok" | "error"; message?: string };
  ended: boolean;
  spanId: string;
  traceId: string;
}

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

  toRecorded(): RecordedSpan {
    return {
      name: this.name,
      attributes: { ...this.attributes },
      parent: this.parent?.toRecorded(),
      status: this._status,
      ended: this._ended,
      spanId: this.spanId,
      traceId: this.traceId,
    };
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
  readonly gauges = new Map<string, number>();

  incrementCounter(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  recordHistogram(name: string, value: number): void {
    this.histograms.push({ name, value });
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
}

function makeMockLLM(): LLMProvider {
  return {
    chat: async () => ({
      content: "mock response",
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: "stop" as const,
    }),
    chatStream: async function* () {
      yield {
        content: "mock",
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop" as const,
      };
    },
    countTokens: () => 10,
  };
}

describe("OTelBridgeHandler — cross-agent delegation spans", () => {
  let tracer: MockTracer;
  let metric: MockMetric;
  let bridge: OTelBridgeHandler;

  beforeEach(() => {
    spanCounter = 0;
    tracer = new MockTracer();
    metric = new MockMetric();
    bridge = new OTelBridgeHandler(tracer, metric);
  });

  it("creates a delegation span with correct attributes", () => {
    const span = bridge.handleDelegationStart({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "summarize",
    });

    expect(span).toBeDefined();
    expect(tracer.spans).toHaveLength(1);

    const recorded = tracer.spans[0];
    expect(recorded.name).toBe("delegation");
    expect(recorded.attributes["agent.id"]).toBe("agent-a");
    expect(recorded.attributes["agent.name"]).toBe("agent-a");
    expect(recorded.attributes["delegation.from"]).toBe("agent-a");
    expect(recorded.attributes["delegation.to"]).toBe("agent-b");
    expect(recorded.attributes["delegation.task"]).toBe("summarize");
  });

  it("creates child span under parent span when parent provided", () => {
    const parentSpan = tracer.startSpan("turn", undefined, { "turn.id": "t1" });

    const childSpan = bridge.handleDelegationStart({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "analyze",
      parentSpan,
    });

    // Both spans should share the same traceId (parent's traceId)
    const mockChild = childSpan as unknown as MockSpan;
    expect(mockChild.traceId).toBe((parentSpan as unknown as MockSpan).traceId);

    // The child's parent should be the turn span
    expect(mockChild.parent).toBe(parentSpan as unknown as MockSpan);
  });

  it("ends delegation span with ok status", () => {
    const span = bridge.handleDelegationStart({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "task",
    });

    bridge.handleDelegationEnd({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      status: "ok",
      delegationSpan: span,
    });

    const mockSpan = span as unknown as MockSpan;
    expect(mockSpan.ended).toBe(true);
    expect(mockSpan.status).toEqual({ code: "ok", message: undefined });
  });

  it("ends delegation span with error status and error message", () => {
    const span = bridge.handleDelegationStart({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "task",
    });

    bridge.handleDelegationEnd({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      status: "error",
      error: "LLM failure",
      delegationSpan: span,
    });

    const mockSpan = span as unknown as MockSpan;
    expect(mockSpan.ended).toBe(true);
    expect(mockSpan.status).toEqual({ code: "error", message: "LLM failure" });
    expect(mockSpan.attributes["error.message"]).toBe("LLM failure");
  });

  it("tracks delegation metrics", () => {
    const span = bridge.handleDelegationStart({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "task",
    });

    bridge.handleDelegationEnd({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      status: "ok",
      delegationSpan: span,
    });

    expect(metric.counters.get("proteus.delegation.total")).toBe(1);
    expect(metric.counters.get("proteus.delegation.completed")).toBe(1);
  });

  it("supports nested delegations (A -> B -> C)", () => {
    // Agent A's chain span
    const chainSpan = tracer.startSpan("chain", undefined, { "chain.id": "c1" });

    // A delegates to B — child of chain
    const abSpan = bridge.handleDelegationStart({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "step 1",
      parentSpan: chainSpan,
    });

    // B delegates to C — child of A->B delegation
    const bcSpan = bridge.handleDelegationStart({
      fromAgentId: "agent-b",
      toAgentId: "agent-c",
      task: "step 2",
      parentSpan: abSpan,
    });

    // All should share the same traceId
    const mockAB = abSpan as unknown as MockSpan;
    const mockBC = bcSpan as unknown as MockSpan;
    const mockChain = chainSpan as unknown as MockSpan;

    expect(mockAB.traceId).toBe(mockChain.traceId);
    expect(mockBC.traceId).toBe(mockChain.traceId);

    // Parent chain: chain -> A->B -> B->C
    expect(mockAB.parent).toBe(mockChain);
    expect(mockBC.parent).toBe(mockAB);

    // End in reverse order
    bridge.handleDelegationEnd({
      fromAgentId: "agent-b",
      toAgentId: "agent-c",
      status: "ok",
      delegationSpan: bcSpan,
    });

    bridge.handleDelegationEnd({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      status: "ok",
      delegationSpan: abSpan,
    });

    expect(mockBC.ended).toBe(true);
    expect(mockAB.ended).toBe(true);
  });
});

describe("createOTelBridgeHandlers — delegation events", () => {
  it("registers delegation:start and delegation:end handlers", () => {
    const tracer = new MockTracer();
    const metric = new MockMetric();
    const handlers = createOTelBridgeHandlers(tracer, metric);

    const eventNames = handlers.flatMap(h => h.events);
    expect(eventNames).toContain("delegation:start");
    expect(eventNames).toContain("delegation:end");
  });
});

describe("AgentRouter — OTel span integration", () => {
  let registry: AgentRegistry;
  let tracer: MockTracer;

  function makeAgent(id: string): AgentContext {
    const engine = new HandlerEngine();
    return new AgentContext({
      llm: makeMockLLM(),
      tools: new Map<string, Tool>(),
      handlerEngine: engine,
    });
  }

  beforeEach(() => {
    spanCounter = 0;
    registry = new AgentRegistry();
    tracer = new MockTracer();
  });

  it("creates delegation span under active span when tracer provided", async () => {
    const agentA = makeAgent("agent-a");
    const agentB = makeAgent("agent-b");
    registry.register("agent-a", agentA);
    registry.register("agent-b", agentB);

    // Set up an active span to act as the parent
    const parentSpan = tracer.startSpan("turn", undefined, { "turn.id": "t1" });

    const router = new AgentRouter(registry, tracer);

    const result = await router.delegate({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "test delegation",
    });

    expect(result.ok).toBe(true);

    // Should have parent span + delegation span
    expect(tracer.spans).toHaveLength(2);
    const delegationSpan = tracer.spans[1];
    expect(delegationSpan.name).toBe("delegation");
    expect(delegationSpan.attributes["delegation.from"]).toBe("agent-a");
    expect(delegationSpan.attributes["delegation.to"]).toBe("agent-b");
    expect(delegationSpan.attributes["delegation.task"]).toBe("test delegation");

    // Child-parent relationship
    expect(delegationSpan.parent).toBe(parentSpan);
    expect(delegationSpan.traceId).toBe(parentSpan.traceId);
    expect(delegationSpan.ended).toBe(true);
    expect(delegationSpan.status).toEqual({ code: "ok", message: undefined });
  });

  it("creates delegation span without parent when no active span", async () => {
    const agentA = makeAgent("agent-a");
    const agentB = makeAgent("agent-b");
    registry.register("agent-a", agentA);
    registry.register("agent-b", agentB);

    // No active span — tracer returns undefined
    const router = new AgentRouter(registry, tracer);

    const result = await router.delegate({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "root delegation",
    });

    expect(result.ok).toBe(true);
    expect(tracer.spans).toHaveLength(1);

    const delegationSpan = tracer.spans[0];
    expect(delegationSpan.name).toBe("delegation");
    expect(delegationSpan.parent).toBeUndefined();
    expect(delegationSpan.ended).toBe(true);
  });

  it("ends span with error on delegation failure", async () => {
    const brokenLLM: LLMProvider = {
      chat: async () => { throw new Error("LLM exploded"); },
      chatStream: async function* () { throw new Error("LLM exploded"); },
      countTokens: () => 0,
    };

    const agentA = makeAgent("agent-a");
    const agentB = new AgentContext({
      llm: brokenLLM,
      tools: new Map<string, Tool>(),
      handlerEngine: new HandlerEngine(),
    });
    registry.register("agent-a", agentA);
    registry.register("agent-b", agentB);

    const router = new AgentRouter(registry, tracer);

    const result = await router.delegate({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "fail task",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.ok).toBe(false);
    }

    const delegationSpan = tracer.spans[0];
    expect(delegationSpan.ended).toBe(true);
    expect(delegationSpan.status).toEqual({ code: "error", message: "LLM exploded" });
    expect(delegationSpan.attributes["error.message"]).toBe("LLM exploded");
  });

  it("does not create span when tracer not provided", async () => {
    const agentA = makeAgent("agent-a");
    const agentB = makeAgent("agent-b");
    registry.register("agent-a", agentA);
    registry.register("agent-b", agentB);

    // No tracer
    const router = new AgentRouter(registry);

    const result = await router.delegate({
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      task: "no tracing",
    });

    expect(result.ok).toBe(true);
    expect(tracer.spans).toHaveLength(0);
  });
});
