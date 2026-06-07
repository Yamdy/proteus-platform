import { describe, it, expect } from "vitest";
import { FIFOTruncation, SlidingWindowTruncation } from "../truncation.js";
import type { LLMMessage } from "../../types.js";

function msg(role: LLMMessage["role"], content: string): LLMMessage {
  return { role, content };
}

// Simple token counter: 1 token per word
function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

describe("FIFOTruncation", () => {
  const strategy = new FIFOTruncation();

  it("returns empty for empty input", () => {
    expect(strategy.truncate([], 100, countTokens)).toEqual([]);
  });

  it("returns empty for zero budget", () => {
    expect(strategy.truncate([msg("user", "hello")], 0, countTokens)).toEqual([]);
  });

  it("keeps all messages within budget", () => {
    const messages = [msg("user", "a"), msg("assistant", "b"), msg("user", "c")];
    const result = strategy.truncate(messages, 100, countTokens);
    expect(result).toHaveLength(3);
  });

  it("drops oldest messages when over budget", () => {
    const messages = [
      msg("user", "one two three four five"),
      msg("assistant", "six seven eight"),
      msg("user", "nine ten"),
    ];
    // Budget = 5 tokens, last 2 messages have 2+2=4 tokens
    const result = strategy.truncate(messages, 5, countTokens);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("six seven eight");
    expect(result[1].content).toBe("nine ten");
  });

  it("keeps the most recent single message if it fits", () => {
    const messages = [msg("user", "hello world")];
    const result = strategy.truncate(messages, 2, countTokens);
    expect(result).toHaveLength(1);
  });

  it("returns empty if most recent message exceeds budget", () => {
    const messages = [msg("user", "one two three")];
    const result = strategy.truncate(messages, 2, countTokens);
    expect(result).toHaveLength(0);
  });
});

describe("SlidingWindowTruncation", () => {
  const strategy = new SlidingWindowTruncation({ systemReserve: 0.5 });

  it("returns empty for empty input", () => {
    expect(strategy.truncate([], 100, countTokens)).toEqual([]);
  });

  it("returns empty for zero budget", () => {
    expect(strategy.truncate([msg("system", "sys")], 0, countTokens)).toEqual([]);
  });

  it("preserves leading system messages", () => {
    const messages = [
      msg("system", "you are helpful"),
      msg("user", "hello"),
      msg("assistant", "hi"),
    ];
    const result = strategy.truncate(messages, 100, countTokens);
    expect(result[0].role).toBe("system");
    expect(result[0].content).toBe("you are helpful");
  });

  it("drops oldest non-system messages when over budget", () => {
    const messages = [
      msg("system", "sys"),
      msg("user", "one two three four five"),
      msg("assistant", "six seven eight"),
      msg("user", "nine ten"),
    ];
    // budget=8, systemReserve=0.5 => systemBudget=4, recentBudget=4
    // system "sys" = 1 token, fits in systemBudget
    // recent: last msg "nine ten" = 2 tokens, + "six seven eight" = 3 tokens = 5 > 4
    // so only "nine ten" fits
    const result = strategy.truncate(messages, 8, countTokens);
    expect(result[0].role).toBe("system");
    expect(result[result.length - 1].content).toBe("nine ten");
  });

  it("handles no system messages", () => {
    const messages = [msg("user", "hello"), msg("assistant", "hi")];
    const result = strategy.truncate(messages, 100, countTokens);
    expect(result).toHaveLength(2);
  });
});
