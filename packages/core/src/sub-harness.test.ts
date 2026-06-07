import { describe, it, expect, beforeEach } from "vitest";
import { SubHarness } from "./sub-harness.js";
import { SessionContext, AgentContext, WorkingMemory } from "./context.js";
import { HandlerEngine } from "./handler-engine.js";
import { createInMemoryStore } from "./checkpoint-store.js";
import type { LLMProvider, Tool, LLMMessage } from "./types.js";

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

function makeAgent(): AgentContext {
  return new AgentContext({
    llm: makeMockLLM(),
    tools: new Map<string, Tool>(),
    handlerEngine: new HandlerEngine(),
  });
}

function makeParentSession(id: string, messages?: LLMMessage[]): SessionContext {
  const session = new SessionContext({
    sessionId: id,
    llm: { provider: "unknown", model: "unknown", temperature: 0 },
    tools: {},
    logLevel: "info",
  });
  if (messages) {
    for (const msg of messages) {
      session.workingMemory.push(msg);
    }
  }
  return session;
}

describe("SubHarness", () => {
  const store = createInMemoryStore();

  describe("isolation: full", () => {
    it("creates a fresh SessionContext with no parent state", () => {
      const parent = makeParentSession("parent-1", [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi there" },
      ]);

      const sub = new SubHarness(
        { store },
        { isolation: "full", parentContext: parent },
      );

      const childSession = sub.buildSession("child-full-1");

      expect(childSession.sessionId).toBe("child-full-1");
      expect(childSession.workingMemory.getMessages()).toEqual([]);
    });

    it("does not inherit parent WorkingMemory", () => {
      const parent = makeParentSession("parent-2", [
        { role: "user", content: "secret context" },
      ]);

      const sub = new SubHarness(
        { store },
        { isolation: "full", parentContext: parent },
      );

      const childSession = sub.buildSession("child-full-2");
      const messages = childSession.workingMemory.getMessages();

      expect(messages).toHaveLength(0);
      expect(messages.some(m => m.content === "secret context")).toBe(false);
    });
  });

  describe("isolation: shared", () => {
    it("inherits parent WorkingMemory messages", () => {
      const parentMessages: LLMMessage[] = [
        { role: "system", content: "You are a helper." },
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
      ];
      const parent = makeParentSession("parent-shared-1", parentMessages);

      const sub = new SubHarness(
        { store },
        { isolation: "shared", parentContext: parent },
      );

      const childSession = sub.buildSession("child-shared-1");
      const childMessages = childSession.workingMemory.getMessages();

      expect(childMessages).toHaveLength(3);
      expect(childMessages[0].content).toBe("You are a helper.");
      expect(childMessages[1].content).toBe("What is 2+2?");
      expect(childMessages[2].content).toBe("4");
    });

    it("child WorkingMemory is independent (copy, not reference)", () => {
      const parent = makeParentSession("parent-shared-2", [
        { role: "user", content: "original" },
      ]);

      const sub = new SubHarness(
        { store },
        { isolation: "shared", parentContext: parent },
      );

      const childSession = sub.buildSession("child-shared-2");

      // Add message to child
      childSession.workingMemory.push({ role: "user", content: "child-only" });

      // Parent should not be affected
      expect(parent.workingMemory.getMessages()).toHaveLength(1);
      expect(childSession.workingMemory.getMessages()).toHaveLength(2);
    });

    it("handles parent with no messages", () => {
      const parent = makeParentSession("parent-shared-empty");

      const sub = new SubHarness(
        { store },
        { isolation: "shared", parentContext: parent },
      );

      const childSession = sub.buildSession("child-shared-empty");

      expect(childSession.workingMemory.getMessages()).toEqual([]);
    });
  });

  describe("isolation: summary", () => {
    it("compresses parent context into a system summary message", () => {
      const parentMessages: LLMMessage[] = [
        { role: "user", content: "Tell me about TypeScript" },
        { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
        { role: "user", content: "What about generics?" },
      ];
      const parent = makeParentSession("parent-summary-1", parentMessages);

      const sub = new SubHarness(
        { store },
        { isolation: "summary", parentContext: parent },
      );

      const childSession = sub.buildSession("child-summary-1");
      const messages = childSession.workingMemory.getMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("Parent context summary");
      expect(messages[0].content).toContain("3 messages");
      expect(messages[0].content).toContain("Tell me about TypeScript");
    });

    it("truncates long messages in summary", () => {
      const longContent = "x".repeat(500);
      const parent = makeParentSession("parent-summary-2", [
        { role: "user", content: longContent },
      ]);

      const sub = new SubHarness(
        { store },
        { isolation: "summary", parentContext: parent },
      );

      const childSession = sub.buildSession("child-summary-2");
      const messages = childSession.workingMemory.getMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain("...");
      // The summary line itself should be shorter than the original
      expect(messages[0].content.length).toBeLessThan(longContent.length + 200);
    });

    it("produces no summary when parent has no messages", () => {
      const parent = makeParentSession("parent-summary-empty");

      const sub = new SubHarness(
        { store },
        { isolation: "summary", parentContext: parent },
      );

      const childSession = sub.buildSession("child-summary-empty");

      expect(childSession.workingMemory.getMessages()).toEqual([]);
    });
  });

  describe("abort signal propagation", () => {
    it("throws when abort signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const sub = new SubHarness(
        { store },
        { isolation: "full", abortSignal: controller.signal },
      );

      const session = sub.buildSession("child-abort-1");
      const agent = makeAgent();

      await expect(() => sub.runTurn(session, agent)).rejects.toThrow("aborted by parent signal");
    });

    it("does not throw when abort signal is not aborted", async () => {
      const controller = new AbortController();

      const sub = new SubHarness(
        { store },
        { isolation: "full", abortSignal: controller.signal },
      );

      const session = sub.buildSession("child-abort-2");
      const agent = makeAgent();

      // Should not throw
      const result = await sub.runTurn(session, agent);
      expect(result.status).toBe("completed");
    });

    it("passes abort signal to runChain", async () => {
      const controller = new AbortController();

      const sub = new SubHarness(
        { store },
        { isolation: "full", abortSignal: controller.signal },
      );

      const session = sub.buildSession("child-abort-chain");
      const agent = makeAgent();

      const result = await sub.runChain(session, agent, { maxTurns: 1 });
      expect(["completed", "max_turns"]).toContain(result.status);
    });
  });

  describe("cost attribution", () => {
    it("attributes child cost to parent session", async () => {
      const parent = makeParentSession("parent-cost-1");

      const sub = new SubHarness(
        { store },
        {
          isolation: "full",
          parentContext: parent,
          costAttribution: { parentSessionId: "parent-cost-1" },
        },
      );

      const session = sub.buildSession("child-cost-1");
      const agent = makeAgent();

      // Run a turn (mock LLM returns 10 prompt + 5 completion tokens)
      await sub.runTurn(session, agent);

      // Child session should have cost recorded
      const childCost = session.costTracker.getTotals();
      expect(childCost.promptTokens).toBe(10);
      expect(childCost.completionTokens).toBe(5);

      // Parent should have received the attributed cost
      const parentCost = parent.costTracker.getTotals();
      expect(parentCost.promptTokens).toBe(10);
      expect(parentCost.completionTokens).toBe(5);
    });

    it("accumulates cost across multiple turns", async () => {
      const parent = makeParentSession("parent-cost-2");

      const sub = new SubHarness(
        { store },
        {
          isolation: "full",
          parentContext: parent,
          costAttribution: { parentSessionId: "parent-cost-2" },
        },
      );

      const session = sub.buildSession("child-cost-2");
      const agent = makeAgent();

      await sub.runTurn(session, agent);
      await sub.runTurn(session, agent);

      const parentCost = parent.costTracker.getTotals();
      expect(parentCost.promptTokens).toBe(20);
      expect(parentCost.completionTokens).toBe(10);
    });

    it("does not attribute cost when costAttribution is not set", async () => {
      const parent = makeParentSession("parent-cost-none");

      const sub = new SubHarness(
        { store },
        { isolation: "full", parentContext: parent },
      );

      const session = sub.buildSession("child-cost-none");
      const agent = makeAgent();

      await sub.runTurn(session, agent);

      const parentCost = parent.costTracker.getTotals();
      expect(parentCost.promptTokens).toBe(0);
      expect(parentCost.completionTokens).toBe(0);
    });
  });

  describe("session accessor", () => {
    it("returns undefined before buildSession is called", () => {
      const sub = new SubHarness(
        { store },
        { isolation: "full" },
      );

      expect(sub.session).toBeUndefined();
    });

    it("returns the built session after buildSession", () => {
      const sub = new SubHarness(
        { store },
        { isolation: "full" },
      );

      const built = sub.buildSession("child-accessor-1");

      expect(sub.session).toBe(built);
      expect(sub.session?.sessionId).toBe("child-accessor-1");
    });
  });
});
