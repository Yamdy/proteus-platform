import { describe, it, expect, beforeEach } from "vitest";
import { AgentRouter } from "./agent-router.js";
import { AgentRegistry } from "./agent-registry.js";
import { AgentContext } from "./context.js";
import { HandlerEngine } from "./handler-engine.js";
import type { LLMProvider, Tool, DelegationRequest } from "./types.js";

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

function makeAgent(id: string, events?: Array<{ event: string; payload: unknown }>): AgentContext {
  const engine = new HandlerEngine();
  if (events) {
    engine.observe("*", async (ctx: any) => {
      events.push({ event: "observed", payload: ctx });
      return { ok: true };
    }, 0, "spy");
  }
  return new AgentContext({
    llm: makeMockLLM(),
    tools: new Map<string, Tool>(),
    handlerEngine: engine,
  });
}

describe("AgentRouter", () => {
  let registry: AgentRegistry;
  let router: AgentRouter;

  beforeEach(() => {
    registry = new AgentRegistry();
    router = new AgentRouter(registry);
  });

  describe("delegate()", () => {
    it("returns error when source agent not found", async () => {
      registry.register("agent-b", makeAgent("agent-b"));

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "do something",
      };

      const result = await router.delegate(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/Source agent.*not found/);
      }
    });

    it("returns error when target agent not found", async () => {
      registry.register("agent-a", makeAgent("agent-a"));

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "do something",
      };

      const result = await router.delegate(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/Target agent.*not found/);
      }
    });

    it("successfully delegates between two agents", async () => {
      const agentA = makeAgent("agent-a");
      const agentB = makeAgent("agent-b");
      registry.register("agent-a", agentA);
      registry.register("agent-b", agentB);

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "summarize this document",
      };

      const result = await router.delegate(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.ok).toBe(true);
        expect(result.result.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("includes context and metadata in delegation", async () => {
      const agentA = makeAgent("agent-a");
      const agentB = makeAgent("agent-b");
      registry.register("agent-a", agentA);
      registry.register("agent-b", agentB);

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "analyze",
        context: { data: "some data" },
        metadata: { priority: "high" },
      };

      const result = await router.delegate(request);

      expect(result.ok).toBe(true);
    });

    it("emits delegation:start and delegation:end events", async () => {
      const emittedEvents: Array<{ event: string; payload: unknown }> = [];

      const engine = new HandlerEngine();
      engine.observe("delegation:start", async (ctx: any) => {
        emittedEvents.push({ event: "delegation:start", payload: ctx });
        return { ok: true };
      }, 0, "start-observer");
      engine.observe("delegation:end", async (ctx: any) => {
        emittedEvents.push({ event: "delegation:end", payload: ctx });
        return { ok: true };
      }, 0, "end-observer");

      const agentA = new AgentContext({
        llm: makeMockLLM(),
        tools: new Map<string, Tool>(),
        handlerEngine: engine,
      });
      const agentB = makeAgent("agent-b");

      registry.register("agent-a", agentA);
      registry.register("agent-b", agentB);

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "test task",
      };

      await router.delegate(request);

      expect(emittedEvents.some((e) => e.event === "delegation:start")).toBe(true);
      expect(emittedEvents.some((e) => e.event === "delegation:end")).toBe(true);
    });

    it("emits delegation:error event on exception", async () => {
      const emittedEvents: Array<{ event: string; payload: unknown }> = [];

      const engine = new HandlerEngine();
      engine.observe("delegation:error", async (ctx: any) => {
        emittedEvents.push({ event: "delegation:error", payload: ctx });
        return { ok: true };
      }, 0, "error-observer");

      // Create an agent with a broken LLM that throws
      const brokenLLM: LLMProvider = {
        chat: async () => { throw new Error("LLM failure"); },
        chatStream: async function* () { throw new Error("LLM failure"); },
        countTokens: () => 0,
      };

      const agentA = new AgentContext({
        llm: makeMockLLM(),
        tools: new Map<string, Tool>(),
        handlerEngine: engine,
      });
      const agentB = new AgentContext({
        llm: brokenLLM,
        tools: new Map<string, Tool>(),
        handlerEngine: new HandlerEngine(),
      });

      registry.register("agent-a", agentA);
      registry.register("agent-b", agentB);

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "fail task",
      };

      const result = await router.delegate(request);

      // The delegation itself returns ok:true with a failed DelegationResult
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.ok).toBe(false);
        expect(result.result.error).toBeDefined();
        expect(result.result.duration).toBeGreaterThanOrEqual(0);
      }

      expect(emittedEvents.some((e) => e.event === "delegation:error")).toBe(true);
    });

    it("measures duration correctly", async () => {
      const agentA = makeAgent("agent-a");
      const agentB = makeAgent("agent-b");
      registry.register("agent-a", agentA);
      registry.register("agent-b", agentB);

      const request: DelegationRequest = {
        fromAgentId: "agent-a",
        toAgentId: "agent-b",
        task: "quick task",
      };

      const result = await router.delegate(request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.duration).toBeGreaterThanOrEqual(0);
        expect(result.result.duration).toBeLessThan(5000);
      }
    });
  });
});

describe("AgentRegistry", () => {
  it("registers and retrieves an agent", async () => {
    const { AgentRegistry } = await import("./agent-registry.js");
    const registry = new AgentRegistry();
    const agent = makeAgent("test-agent");

    registry.register("test-agent", agent);

    expect(registry.get("test-agent")).toBe(agent);
    expect(registry.has("test-agent")).toBe(true);
    expect(registry.list()).toEqual(["test-agent"]);
  });

  it("throws on duplicate registration", async () => {
    const { AgentRegistry } = await import("./agent-registry.js");
    const registry = new AgentRegistry();
    const agent = makeAgent("test-agent");

    registry.register("test-agent", agent);

    expect(() => registry.register("test-agent", agent)).toThrow(/already registered/);
  });

  it("unregisters an agent", async () => {
    const { AgentRegistry } = await import("./agent-registry.js");
    const registry = new AgentRegistry();
    const agent = makeAgent("test-agent");

    registry.register("test-agent", agent);
    registry.unregister("test-agent");

    expect(registry.has("test-agent")).toBe(false);
    expect(registry.get("test-agent")).toBeUndefined();
  });

  it("returns undefined for unknown agent", async () => {
    const { AgentRegistry } = await import("./agent-registry.js");
    const registry = new AgentRegistry();

    expect(registry.get("unknown")).toBeUndefined();
    expect(registry.has("unknown")).toBe(false);
  });
});
