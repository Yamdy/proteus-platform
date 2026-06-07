import type { LLMMessage } from "../types.js";
import type { EmbeddingProvider, EmbeddedEntry } from "./types.js";

let nextId = 0;

/** Map-based in-memory implementation of EmbeddingProvider. */
export class InMemoryEmbeddingProvider implements EmbeddingProvider {
  private entries = new Map<string, EmbeddedEntry[]>();
  private embeddings = new Map<string, Float64Array>();

  addEntry(threadId: string, entry: LLMMessage): string {
    const id = `entry-${++nextId}`;
    const record: EmbeddedEntry = { id, threadId, entry, embedding: new Float64Array(0) };
    const existing = this.entries.get(threadId) ?? [];
    existing.push(record);
    this.entries.set(threadId, existing);
    return id;
  }

  loadEntries(threadId: string): EmbeddedEntry[] {
    return [...(this.entries.get(threadId) ?? [])];
  }

  storeEmbedding(entryId: string, embedding: Float64Array): void {
    this.embeddings.set(entryId, embedding);
    // Also update the entry record so loadEntries returns the embedding
    for (const [, entries] of this.entries) {
      const match = entries.find((e) => e.id === entryId);
      if (match) {
        match.embedding = embedding;
        break;
      }
    }
  }

  getEmbedding(entryId: string): Float64Array | null {
    return this.embeddings.get(entryId) ?? null;
  }
}
