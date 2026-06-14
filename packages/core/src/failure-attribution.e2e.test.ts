import { describe, it, expect, vi } from "vitest";
import {
  attributeFailure,
  InMemoryAttributionStore,
} from "./failure-attribution.js";
import type {
  AttributionRecord,
  AttributionCategory,
} from "./failure-attribution.js";
import {
  SessionContext,
  AgentContext,
  TurnContext,
  HandlerContext,
  FrozenContext,
} from "./context.js";
import type { EventLog, StoreEvent } from "./checkpoint-store.js";
import type { LLMMessage } from "./types.js";

// ============================================================
// Helpers
// ============================================================

function makeAgentContext(): AgentContext {
  return new AgentContext({
    llm: {
      chat: async () => ({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: "stop" as const,
      }),
      chatStream: async function* () {},
      countTokens: () => 0,
    },
    tools: new Map(),
  });
}

function makeSessionContext(sessionId = "sess-1"): SessionContext {
  return new SessionContext({
    sessionId,
    llm: { provider: "test", model: "test", temperature: 0 },
    tools: {},
    logLevel: "info",
  });
}

function makeHandlerContext(
  messages: LLMMessage[] = [],
  sessionId = "sess-1",
): HandlerContext {
  const agent = makeAgentContext();
  const session = makeSessionContext(sessionId);
  const turn = new TurnContext({
    turnId: "turn-1",
    agent,
    session,
  });
  for (const msg of messages) {
    turn.addMessage(msg);
  }
  return new HandlerContext({ agent, session, turn });
}

/** Create a minimal mock EventLog for verifying persistence calls. */
function mockEventLog(): EventLog & { calls: StoreEvent[] } {
  const calls: StoreEvent[] = [];
  return {
    calls,
    appendEvent(event: StoreEvent) {
      calls.push(event);
    },
    queryEvents: vi.fn().mockReturnValue([]),
    queryAllEvents: vi.fn().mockReturnValue([]),
  };
}

// ============================================================
// US 16: Failure Attribution
// ============================================================

describe("US 16 — attributeFailure phase-to-category mapping", () => {
  const cases: [string, AttributionCategory][] = [
    ["context_assembly", "C"],
    ["llm_inference", "L"],
    ["tool_execution", "T"],
    ["action_resolution", "T"],
    ["result_observation", "O"],
    ["governance", "G"],
  ];

  for (const [phase, expected] of cases) {
    it(`maps "${phase}" to category "${expected}"`, () => {
      const record = attributeFailure({
        phase,
        error: new Error(`${phase} failed`),
      });
      expect(record.category).toBe(expected);
      expect(record.phase).toBe(phase);
      expect(record.error).toBe(`${phase} failed`);
      expect(record.timestamp).toBeGreaterThan(0);
    });
  }

  it('maps "handler" with trust to category "E"', () => {
    const record = attributeFailure({
      phase: "handler",
      error: new Error("handler crashed"),
      trust: 5,
    });
    expect(record.category).toBe("E");
  });

  it("defaults unknown phases to category O", () => {
    const record = attributeFailure({
      phase: "some_unknown_phase",
      error: new Error("unknown"),
    });
    expect(record.category).toBe("O");
  });

  it("passes sessionId and metadata through", () => {
    const record = attributeFailure({
      phase: "tool_execution",
      error: new Error("boom"),
      sessionId: "sess-42",
      metadata: { toolName: "web_search" },
    });
    expect(record.sessionId).toBe("sess-42");
    expect(record.metadata).toEqual({ toolName: "web_search" });
  });
});

describe("US 16 — InMemoryAttributionStore save and query", () => {
  function seedStore() {
    const store = new InMemoryAttributionStore();
    const now = Date.now();
    const records: AttributionRecord[] = [
      { category: "T", phase: "tool_execution", error: "e1", timestamp: now - 3000, sessionId: "s1" },
      { category: "L", phase: "llm_inference", error: "e2", timestamp: now - 2000, sessionId: "s1" },
      { category: "T", phase: "tool_execution", error: "e3", timestamp: now - 1000, sessionId: "s2" },
      { category: "C", phase: "context_assembly", error: "e4", timestamp: now, sessionId: "s2" },
    ];
    for (const r of records) store.save(r);
    return { store, records, now };
  }

  it("saves and retrieves all records", () => {
    const { store } = seedStore();
    expect(store.query()).toHaveLength(4);
  });

  it("filters by category", () => {
    const { store } = seedStore();
    const tRecords = store.query({ category: "T" });
    expect(tRecords).toHaveLength(2);
    expect(tRecords.every((r) => r.category === "T")).toBe(true);
  });

  it("filters by sessionId", () => {
    const { store } = seedStore();
    const s1 = store.query({ sessionId: "s1" });
    expect(s1).toHaveLength(2);
    expect(s1.every((r) => r.sessionId === "s1")).toBe(true);
  });

  it("filters by since timestamp", () => {
    const { store, now } = seedStore();
    const recent = store.query({ since: now - 1500 });
    // Records at now-1000 and now should match
    expect(recent).toHaveLength(2);
    expect(recent.every((r) => r.timestamp >= now - 1500)).toBe(true);
  });

  it("combines multiple filters", () => {
    const { store, now } = seedStore();
    const result = store.query({ category: "T", sessionId: "s1", since: now - 3500 });
    expect(result).toHaveLength(1);
    expect(result[0].error).toBe("e1");
  });
});

describe("US 16 — InMemoryAttributionStore persists to EventLog", () => {
  it("appends event to EventLog when sessionId is present", () => {
    const log = mockEventLog();
    const store = new InMemoryAttributionStore(log);

    const record: AttributionRecord = {
      category: "C",
      phase: "context_assembly",
      error: "context overflow",
      timestamp: 1000,
      sessionId: "s1",
    };
    store.save(record);

    expect(log.calls).toHaveLength(1);
    expect(log.calls[0].sessionId).toBe("s1");
    expect(log.calls[0].event).toBe("attribution");
    expect(log.calls[0].payload).toEqual(record);
    expect(log.calls[0].timestamp).toBe(1000);
  });

  it("does not append event when sessionId is absent", () => {
    const log = mockEventLog();
    const store = new InMemoryAttributionStore(log);

    const record: AttributionRecord = {
      category: "L",
      phase: "llm_inference",
      error: "timeout",
      timestamp: 2000,
    };
    store.save(record);

    expect(log.calls).toHaveLength(0);
  });
});

// ============================================================
// US 25: FrozenContext Replay
// ============================================================

describe("US 25 — FrozenContext preserves turn state", () => {
  it("captures messages, turnId, sessionId, and timestamp", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ];
    const ctx = makeHandlerContext(messages, "sess-42");
    const frozen = ctx.freeze(1234567890);

    expect(frozen.turnId).toBe("turn-1");
    expect(frozen.sessionId).toBe("sess-42");
    expect(frozen.timestamp).toBe(1234567890);
    expect(frozen.messages).toHaveLength(2);
    expect(frozen.messages[0].role).toBe("user");
    expect(frozen.messages[0].content).toBe("hello");
    expect(frozen.messages[1].role).toBe("assistant");
    expect(frozen.messages[1].content).toBe("hi there");
  });

  it("has a non-empty checksum", () => {
    const ctx = makeHandlerContext();
    const frozen = ctx.freeze(1000);

    expect(frozen.checksum).toBeDefined();
    expect(typeof frozen.checksum).toBe("string");
    expect(frozen.checksum.length).toBe(64); // SHA-256 hex
  });

  it("produces identical checksums for identical state", () => {
    const messages: LLMMessage[] = [{ role: "user", content: "same" }];
    const ctx1 = makeHandlerContext(messages, "sess-x");
    const ctx2 = makeHandlerContext(messages, "sess-x");
    const f1 = ctx1.freeze(5000);
    const f2 = ctx2.freeze(5000);

    expect(f1.checksum).toBe(f2.checksum);
  });

  it("produces different checksums for different state", () => {
    const ctx1 = makeHandlerContext(
      [{ role: "user", content: "alpha" }],
      "sess-1",
    );
    const ctx2 = makeHandlerContext(
      [{ role: "user", content: "beta" }],
      "sess-1",
    );
    const f1 = ctx1.freeze(1000);
    const f2 = ctx2.freeze(1000);

    expect(f1.checksum).not.toBe(f2.checksum);
  });

  it("captures toolResults and promptFragments from the turn", () => {
    const ctx = makeHandlerContext();
    ctx.turn.addToolResult({
      output: "ok",
    });
    ctx.turn.addPromptFragment({
      role: "system",
      content: "You are helpful.",
    });

    const frozen = ctx.freeze(9999);

    expect(frozen.toolResults).toHaveLength(1);
    expect(frozen.toolResults[0].output).toBe("ok");
    expect(frozen.promptFragments).toHaveLength(1);
    expect(frozen.promptFragments[0].content).toBe("You are helpful.");
  });

  it("captures costTotals", () => {
    const ctx = makeHandlerContext();
    ctx.session.costTracker.addUsage({ promptTokens: 100, completionTokens: 50 });
    const frozen = ctx.freeze(8888);

    expect(frozen.costTotals).toEqual({
      promptTokens: 100,
      completionTokens: 50,
    });
  });

  it("FrozenContext arrays are frozen (immutable)", () => {
    const ctx = makeHandlerContext([{ role: "user", content: "test" }]);
    const frozen = ctx.freeze(7777);

    expect(() => {
      (frozen.messages as any).push({ role: "assistant", content: "oops" });
    }).toThrow();
  });
});

describe("US 25 — FrozenContext is serializable", () => {
  it("survives JSON round-trip", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
    ];
    const ctx = makeHandlerContext(messages, "sess-serialize");
    ctx.turn.addToolResult({ output: "computed" });
    ctx.session.costTracker.addUsage({ promptTokens: 200, completionTokens: 80 });

    const original = ctx.freeze(1111111111);
    const json = JSON.stringify(original);
    const restored = JSON.parse(json);

    expect(restored.timestamp).toBe(original.timestamp);
    expect(restored.checksum).toBe(original.checksum);
    expect(restored.sessionId).toBe(original.sessionId);
    expect(restored.turnId).toBe(original.turnId);
    expect(restored.messages).toEqual([...original.messages]);
    expect(restored.toolResults).toEqual([...original.toolResults]);
    expect(restored.promptFragments).toEqual([...original.promptFragments]);
    expect(restored.costTotals).toEqual({ ...original.costTotals });
  });

  it("checksum validates the original payload, not serialized form", () => {
    const ctx = makeHandlerContext(
      [{ role: "user", content: "checksum test" }],
      "sess-check",
    );
    const frozen = ctx.freeze(2222222222);

    // Round-trip
    const restored = JSON.parse(JSON.stringify(frozen));

    // The checksum should still match the original data
    expect(restored.checksum).toBe(frozen.checksum);
    expect(restored.checksum).toHaveLength(64);
  });
});

describe("US 25 — FrozenContext.forSuspend", () => {
  it("includes resumeReason and pendingInput", () => {
    const ctx = makeHandlerContext();
    const frozen = FrozenContext.forSuspend(ctx, { userReply: "yes" }, 3333);

    expect(frozen.resumeReason).toBe("suspend");
    expect(frozen.pendingInput).toEqual({ userReply: "yes" });
    expect(frozen.timestamp).toBe(3333);
  });

  it("reuses base checksum (resumeReason is metadata, not checksummed)", () => {
    const ctx = makeHandlerContext(
      [{ role: "user", content: "suspend me" }],
      "sess-suspend",
    );
    const base = ctx.freeze(4444);
    const suspended = FrozenContext.forSuspend(ctx, undefined, 4444);

    // forSuspend preserves the base checksum — resumeReason/pendingInput are metadata
    expect(suspended.checksum).toBe(base.checksum);
    expect(suspended.checksum).toHaveLength(64);
  });
});
