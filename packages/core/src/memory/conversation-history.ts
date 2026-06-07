// @proteus/core - ConversationHistory: wraps MemoryProvider + TruncationStrategy

import type { LLMMessage } from "../types.js";
import type { MemoryProvider, MemoryEntry } from "./types.js";
import type { TruncationStrategy } from "./truncation.js";
import { FIFOTruncation } from "./truncation.js";

// --- ConversationHistory ---

export interface ConversationHistoryOptions {
  provider: MemoryProvider;
  strategy?: TruncationStrategy;
  maxMessages?: number;
  maxTokens?: number;
}

export class ConversationHistory {
  private readonly provider: MemoryProvider;
  private readonly strategy: TruncationStrategy;
  private readonly maxMessages: number;
  private readonly maxTokens: number;

  constructor(opts: ConversationHistoryOptions) {
    this.provider = opts.provider;
    this.strategy = opts.strategy ?? new FIFOTruncation();
    this.maxMessages = opts.maxMessages ?? 100;
    this.maxTokens = opts.maxTokens ?? 4000;
  }

  getMessages(threadId: string, countTokens?: (text: string) => number): LLMMessage[] {
    const entries = this.provider.getHistory(threadId, this.maxMessages);
    const messages = entries.map(entryToMessage);

    if (countTokens && this.maxTokens > 0) {
      return this.strategy.truncate(messages, this.maxTokens, countTokens);
    }

    return messages;
  }

  addMessage(threadId: string, message: LLMMessage): void {
    const entry: MemoryEntry = {
      id: generateId(),
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
    };
    this.provider.addEntry(threadId, entry);
  }
}

// --- Helpers ---

function entryToMessage(entry: MemoryEntry): LLMMessage {
  return {
    role: entry.role,
    content: entry.content,
  };
}

let counter = 0;
function generateId(): string {
  return "mem_" + Date.now() + "_" + (++counter);
}
