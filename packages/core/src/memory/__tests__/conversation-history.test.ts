import { describe, it, expect, beforeEach } from "vitest";
import { ConversationHistory } from "../conversation-history.js";
import { InMemoryProvider } from "../in-memory-provider.js";
import { FIFOTruncation, SlidingWindowTruncation } from "../truncation.js";
import type { MemoryProvider } from "../types.js";

function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("ConversationHistory", () => {
  let provider: MemoryProvider;

  beforeEach(() => {
    provider = new InMemoryProvider();
    provider.createThread({ threadId: "t1", sessionId: "s1", name: "Test", createdAt: 1000, updatedAt: 1000 });
  });

  describe("addMessage / getMessages", () => {
    it("round-trips a message", () => {
      const history = new ConversationHistory({ provider });
      history.addMessage("t1", { role: "user", content: "hello" });
      const msgs = history.getMessages("t1");
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("hello");
    });

    it("appends multiple messages", () => {
      const history = new ConversationHistory({ provider });
      history.addMessage("t1", { role: "user", content: "hello" });
      history.addMessage("t1", { role: "assistant", content: "hi" });
      expect(history.getMessages("t1")).toHaveLength(2);
    });

    it("returns empty for thread with no messages", () => {
      const history = new ConversationHistory({ provider });
      expect(history.getMessages("t1")).toEqual([]);
    });

    it("respects maxMessages", () => {
      const history = new ConversationHistory({ provider, maxMessages: 2 });
      history.addMessage("t1", { role: "user", content: "first" });
      history.addMessage("t1", { role: "assistant", content: "second" });
      history.addMessage("t1", { role: "user", content: "third" });
      const msgs = history.getMessages("t1");
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe("second");
      expect(msgs[1].content).toBe("third");
    });
  });

  describe("truncation integration", () => {
    it("applies FIFO truncation when countTokens provided", () => {
      const history = new ConversationHistory({
        provider,
        strategy: new FIFOTruncation(),
        maxTokens: 5,
      });
      history.addMessage("t1", { role: "user", content: "one two three four five" });
      history.addMessage("t1", { role: "assistant", content: "six seven" });
      history.addMessage("t1", { role: "user", content: "eight nine" });
      const msgs = history.getMessages("t1", countTokens);
      // last 2 messages: 2+2=4 tokens, fits in budget of 5
      expect(msgs).toHaveLength(2);
    });

    it("applies SlidingWindow truncation when countTokens provided", () => {
      const history = new ConversationHistory({
        provider,
        strategy: new SlidingWindowTruncation({ systemReserve: 0.5 }),
        maxTokens: 10,
      });
      history.addMessage("t1", { role: "system", content: "be helpful" });
      history.addMessage("t1", { role: "user", content: "hello" });
      history.addMessage("t1", { role: "assistant", content: "hi" });
      const msgs = history.getMessages("t1", countTokens);
      expect(msgs[0].role).toBe("system");
    });

    it("skips truncation when no countTokens", () => {
      const history = new ConversationHistory({
        provider,
        strategy: new FIFOTruncation(),
        maxTokens: 1,
      });
      history.addMessage("t1", { role: "user", content: "one two three four five" });
      history.addMessage("t1", { role: "assistant", content: "six seven eight" });
      const msgs = history.getMessages("t1");
      expect(msgs).toHaveLength(2);
    });
  });
});
