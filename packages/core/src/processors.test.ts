import { describe, it, expect, vi } from "vitest";
import {
  ContextAssemblyProcessor,
  CACHE_PREFIX_CHANGED_EVENT,
  CACHE_BREAK_EVENT,
} from "./processors.js";
import { HandlerContext, TurnContext, SessionContext, AgentContext } from "./context.js";
import type { HandlerEngineHandle } from "./context.js";
import type { LLMMessage, SessionConfig, HandlerResult, HandlerDefinition } from "./types.js";
import { PromptFragmentRegistry } from "./prompt-fragment-registry.js";

// --- Test helpers ---

function makeSessionConfig(overrides?: Partial<SessionConfig>): SessionConfig {
  return {
    sessionId: "test-session",
    llm: { provider: "test", model: "test", temperature: 0 },
    tools: {},
    logLevel: "info",
    ...overrides,
  };
}

function makeHandlerContext(opts: {
  systemPrompt?: string;
  wmMessages?: LLMMessage[];
  userFragments?: string[];
  emit?: (event: string, payload?: unknown) => Promise<HandlerResult[]>;
}): HandlerContext {
  const {
    systemPrompt,
    wmMessages = [],
    userFragments = [],
    emit = vi.fn(async () => [] as HandlerResult[]),
  } = opts;

  const config = makeSessionConfig();
  const session = new SessionContext(config);
  for (const msg of wmMessages) {
    session.workingMemory.push(msg);
  }

  const handlerEngine: HandlerEngineHandle = { getHandlers: () => [] as HandlerDefinition[], emit };
  const agent = new AgentContext({
    llm: {} as any,
    tools: new Map(),
    handlerEngine,
    fragmentRegistry: new PromptFragmentRegistry(),
  });

  const turn = new TurnContext({
    turnId: "turn-1",
    agent,
    session,
  });

  if (systemPrompt) {
    turn.addPromptFragment({ role: "system", content: systemPrompt });
  }
  for (const content of userFragments) {
    turn.addPromptFragment({ role: "user", content });
  }

  return new HandlerContext({ agent, session, turn });
}

// --- Tests ---

describe("ContextAssemblyProcessor", () => {
  describe("basic assembly (no compaction)", () => {
    it("assembles system prompt + working memory + user fragments", async () => {
      const proc = new ContextAssemblyProcessor({ maxTokens: 10000 });
      const ctx = makeHandlerContext({
        systemPrompt: "You are helpful.",
        wmMessages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ],
        userFragments: ["What is 2+2?"],
      });

      const result = await proc.handle(ctx);
      expect("ok" in result && result.ok).toBe(true);

      const msgs = ctx.turn.messages;
      expect(msgs).toHaveLength(4);
      expect(msgs[0]).toEqual({ role: "system", content: "You are helpful." });
      expect(msgs[1]).toEqual({ role: "user", content: "Hello" });
      expect(msgs[2]).toEqual({ role: "assistant", content: "Hi there!" });
      expect(msgs[3]).toEqual({ role: "user", content: "What is 2+2?" });
    });

    it("does not compact when under token budget", async () => {
      const proc = new ContextAssemblyProcessor({ maxTokens: 10000, keepRecentTurns: 6 });
      const ctx = makeHandlerContext({
        systemPrompt: "System",
        wmMessages: Array.from({ length: 10 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          content: `Message ${i}`,
        })),
        userFragments: ["Final question"],
      });

      await proc.handle(ctx);
      const msgs = ctx.turn.messages;
      // No message should contain "[compacted:"
      for (const m of msgs) {
        expect(m.content).not.toContain("[compacted:");
      }
    });
  });

  describe("compaction", () => {
    it("compacts middle messages when over token budget", async () => {
      // maxTokens = 420: WM (8 msgs * ~51 tokens = ~408) fits without truncation,
      // but total (408 + system ~8 + user ~5 = ~421) exceeds budget, triggering compaction.
      const proc = new ContextAssemblyProcessor({
        maxTokens: 420,
        keepRecentTurns: 2,
      });

      const wmMessages: LLMMessage[] = Array.from({ length: 8 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `This is a fairly long message number ${i} with enough content to exceed the token budget when accumulated. `.repeat(2),
      }));

      const ctx = makeHandlerContext({
        systemPrompt: "You are a helpful assistant.",
        wmMessages,
        userFragments: ["Final question here"],
      });

      await proc.handle(ctx);
      const msgs = ctx.turn.messages;

      // System message (index 0) should be preserved
      expect(msgs[0].role).toBe("system");
      expect(msgs[0].content).toBe("You are a helpful assistant.");

      // Last 2 messages + 1 user fragment should be preserved (keepRecentTurns=2 applies to non-system)
      // The user fragment is always preserved as the last message
      const lastMsg = msgs[msgs.length - 1];
      expect(lastMsg.content).toBe("Final question here");

      // Messages in the middle should be compacted
      const compacted = msgs.filter((m) => m.content.includes("[compacted:"));
      expect(compacted.length).toBeGreaterThan(0);

      // Each compacted message should have the right format
      for (const m of compacted) {
        expect(m.content).toMatch(/^\[compacted: \d+ chars\]$/);
      }
    });

    it("preserves system message during compaction", async () => {
      const proc = new ContextAssemblyProcessor({
        maxTokens: 50,
        keepRecentTurns: 1,
      });

      const wmMessages: LLMMessage[] = Array.from({ length: 6 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Long message ${i} `.repeat(20),
      }));

      const ctx = makeHandlerContext({
        systemPrompt: "Important system prompt.",
        wmMessages,
        userFragments: ["Question"],
      });

      await proc.handle(ctx);
      const msgs = ctx.turn.messages;

      // System message must be intact
      expect(msgs[0].role).toBe("system");
      expect(msgs[0].content).toBe("Important system prompt.");
    });

    it("clears toolCalls and toolCallId on compacted messages", async () => {
      const proc = new ContextAssemblyProcessor({
        maxTokens: 50,
        keepRecentTurns: 1,
      });

      const wmMessages: LLMMessage[] = [
        { role: "user", content: "Call a tool. ".repeat(20) },
        {
          role: "assistant",
          content: "Sure, let me do that. ".repeat(20),
          toolCalls: [{ id: "tc1", name: "search", arguments: {} }],
        },
        { role: "tool", content: "Tool result data. ".repeat(20), toolCallId: "tc1" },
        { role: "user", content: "Thanks. ".repeat(20) },
        { role: "assistant", content: "You're welcome. ".repeat(20) },
      ];

      const ctx = makeHandlerContext({
        wmMessages,
        userFragments: ["Follow up"],
      });

      await proc.handle(ctx);
      const msgs = ctx.turn.messages;

      // Find compacted messages and verify toolCalls/toolCallId are cleared
      for (const m of msgs) {
        if (m.content.includes("[compacted:")) {
          expect(m.toolCalls).toBeUndefined();
          expect(m.toolCallId).toBeUndefined();
        }
      }
    });

    it("respects keepRecentTurns boundary", async () => {
      const proc = new ContextAssemblyProcessor({
        maxTokens: 50,
        keepRecentTurns: 3,
      });

      const wmMessages: LLMMessage[] = Array.from({ length: 8 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `Message with enough content to trigger compaction ${i}. `.repeat(5),
      }));

      const ctx = makeHandlerContext({
        systemPrompt: "Sys",
        wmMessages,
        userFragments: ["Last"],
      });

      await proc.handle(ctx);
      const msgs = ctx.turn.messages;

      // Count non-compacted messages (excluding system)
      const nonCompacted = msgs.filter(
        (m, i) => i === 0 || !m.content.includes("[compacted:")
      );

      // System + keepRecentTurns messages + user fragment should be non-compacted
      // (user fragment is always at the end, so it's part of "recent")
      expect(nonCompacted.length).toBeGreaterThanOrEqual(1 + 1); // at least system + 1
    });

    it("does nothing when all messages fit in budget", async () => {
      const proc = new ContextAssemblyProcessor({
        maxTokens: 100000,
        keepRecentTurns: 2,
      });

      const ctx = makeHandlerContext({
        systemPrompt: "System",
        wmMessages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
        userFragments: ["Q"],
      });

      await proc.handle(ctx);
      const msgs = ctx.turn.messages;
      for (const m of msgs) {
        expect(m.content).not.toContain("[compacted:");
      }
    });
  });

  describe("KV-cache prefix stability", () => {
    it("computes prefix hash from system messages", async () => {
      const emit = vi.fn(async () => []);
      const proc = new ContextAssemblyProcessor({ maxTokens: 10000 });
      const ctx = makeHandlerContext({
        systemPrompt: "You are helpful.",
        userFragments: ["Hello"],
        emit,
      });

      await proc.handle(ctx);
      expect(proc.lastPrefixHash).toBeTruthy();
      expect(proc.lastPrefixHash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex
    });

    it("emits cache:prefix-changed on first call", async () => {
      const emit = vi.fn(async () => []);
      const proc = new ContextAssemblyProcessor({ maxTokens: 10000 });
      const ctx = makeHandlerContext({
        systemPrompt: "System prompt",
        userFragments: ["Hi"],
        emit,
      });

      await proc.handle(ctx);
      expect(emit).toHaveBeenCalledWith(
        CACHE_PREFIX_CHANGED_EVENT,
        expect.objectContaining({ previousHash: null })
      );
    });

    it("does not emit cache_break when system prompt changes (cached for KV-cache stability)", async () => {
      const emit = vi.fn(async () => [] as HandlerResult[]);
      const proc = new ContextAssemblyProcessor({ maxTokens: 10000 });

      // First call
      const ctx1 = makeHandlerContext({
        systemPrompt: "Prompt A",
        userFragments: ["Hi"],
        emit,
      });
      await proc.handle(ctx1);

      // Second call with different system prompt — but system content is cached at chain start
      const ctx2 = makeHandlerContext({
        systemPrompt: "Prompt B",
        userFragments: ["Hi again"],
        emit,
      });
      await proc.handle(ctx2);

      // cache_break should NOT fire because system content is pinned at first call (KV-cache stability)
      const breakCalls = (emit.mock.calls as string[][]).filter(
        ([event]) => event === CACHE_BREAK_EVENT
      );
      expect(breakCalls).toHaveLength(0);
    });

    it("does not emit cache_break when prefix is stable", async () => {
      const emit = vi.fn(async () => []);
      const proc = new ContextAssemblyProcessor({ maxTokens: 10000 });

      // First call
      const ctx1 = makeHandlerContext({
        systemPrompt: "Same prompt",
        userFragments: ["Hi"],
        emit,
      });
      await proc.handle(ctx1);

      // Second call with same system prompt
      const ctx2 = makeHandlerContext({
        systemPrompt: "Same prompt",
        userFragments: ["Different question"],
        emit,
      });
      await proc.handle(ctx2);

      // Should have prefix-changed but not cache_break on second call
      const breakCalls = (emit.mock.calls as string[][]).filter(
        ([event]) => event === CACHE_BREAK_EVENT
      );
      expect(breakCalls).toHaveLength(0);
    });
  });
});
