// @proteus-ai/core — Memory system types
//
// MemoryProvider is the single abstraction for all memory operations:
// conversation history, working memory, and thread management.

import type { LLMMessage } from "../types.js";

// --- Supporting types ---

export interface MemoryEntry {
  id: string;
  role: LLMMessage["role"];
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type WorkingMemoryData = Record<string, unknown>;

export interface MemoryThreadMeta {
  threadId: string;
  sessionId?: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
}

// --- MemoryProvider interface ---

export interface MemoryProvider {
  // History
  addEntry(threadId: string, entry: MemoryEntry): void;
  getHistory(threadId: string, limit?: number): MemoryEntry[];
  deleteEntry(threadId: string, entryId: string): void;
  clearHistory(threadId: string): void;

  // Working memory
  getWorkingMemory(threadId: string): WorkingMemoryData;
  setWorkingMemory(threadId: string, data: WorkingMemoryData): void;
  mergeWorkingMemory(threadId: string, partial: WorkingMemoryData): void;

  // Threads
  createThread(meta: MemoryThreadMeta): void;
  getThread(threadId: string): MemoryThreadMeta | undefined;
  listThreads(sessionId?: string): MemoryThreadMeta[];
  deleteThread(threadId: string): void;
  cloneThread(threadId: string, newMeta: Partial<MemoryThreadMeta> & { threadId: string }): MemoryThreadMeta | undefined;
}

// --- Embedding types (for semantic recall) ---

/** Function that converts text into an embedding vector. */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

/** A stored entry with its associated embedding. */
export interface EmbeddedEntry {
  id: string;
  threadId: string;
  entry: LLMMessage;
  embedding: Float64Array;
}

/** Result from a semantic search, pairing the original entry with its similarity score. */
export interface SemanticSearchResult {
  entry: LLMMessage;
  score: number;
}

/** Storage provider for entries and their embeddings. */
export interface EmbeddingProvider {
  /** Store a message entry, returns a unique entry ID. */
  addEntry(threadId: string, entry: LLMMessage): string;
  /** Load all entries for a given thread. */
  loadEntries(threadId: string): EmbeddedEntry[];
  /** Persist an embedding vector for an existing entry. */
  storeEmbedding(entryId: string, embedding: Float64Array): void;
  /** Retrieve the embedding vector for an entry, or null if not found. */
  getEmbedding(entryId: string): Float64Array | null;
}
