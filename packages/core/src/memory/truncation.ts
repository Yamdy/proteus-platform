// @proteus/core - Truncation strategies for conversation history

import type { LLMMessage } from "../types.js";

// --- TruncationStrategy interface ---

export interface TruncationStrategy {
  readonly name: string;
  truncate(messages: LLMMessage[], maxTokens: number, countTokens: (text: string) => number): LLMMessage[];
}

// --- FIFO: keep most recent messages within token budget ---

export class FIFOTruncation implements TruncationStrategy {
  readonly name = "fifo";

  truncate(messages: LLMMessage[], maxTokens: number, countTokens: (text: string) => number): LLMMessage[] {
    if (messages.length === 0) return [];
    if (maxTokens <= 0) return [];

    const result: LLMMessage[] = [];
    let totalTokens = 0;

    // Walk from the end (most recent) backwards
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const tokens = countTokens(msg.content);
      if (totalTokens + tokens > maxTokens) break;
      result.unshift(msg);
      totalTokens += tokens;
    }

    return result;
  }
}

// --- SlidingWindow: keep first system message(s) + recent N messages ---

export class SlidingWindowTruncation implements TruncationStrategy {
  readonly name = "sliding-window";
  private readonly systemReserve: number;

  constructor(opts?: { systemReserve?: number }) {
    this.systemReserve = opts?.systemReserve ?? 0.3;
  }

  truncate(messages: LLMMessage[], maxTokens: number, countTokens: (text: string) => number): LLMMessage[] {
    if (messages.length === 0) return [];
    if (maxTokens <= 0) return [];

    const systemBudget = Math.floor(maxTokens * this.systemReserve);
    const recentBudget = maxTokens - systemBudget;

    // Collect leading system messages within budget
    const systemMsgs: LLMMessage[] = [];
    let systemTokens = 0;
    for (const msg of messages) {
      if (msg.role !== "system") break;
      const tokens = countTokens(msg.content);
      if (systemTokens + tokens > systemBudget) break;
      systemMsgs.push(msg);
      systemTokens += tokens;
    }

    // Collect recent non-system messages from the end
    const recentMsgs: LLMMessage[] = [];
    let recentTokens = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "system" && systemMsgs.some(s => s === msg)) continue;
      const tokens = countTokens(msg.content);
      if (recentTokens + tokens > recentBudget) break;
      recentMsgs.unshift(msg);
      recentTokens += tokens;
    }

    return [...systemMsgs, ...recentMsgs];
  }
}
