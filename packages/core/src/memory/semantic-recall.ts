import type { LLMMessage } from "../types.js";
import type { EmbeddingProvider, EmbeddingFunction, SemanticSearchResult } from "./types.js";

/** Default top-K when not specified in constructor or search call. */
const DEFAULT_TOP_K = 5;

/** Default minimum similarity threshold (no filtering). */
const DEFAULT_THRESHOLD = 0;

/** Compute cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export interface SemanticRecallParams {
  provider: EmbeddingProvider;
  embedFn: EmbeddingFunction;
  topK?: number;
  threshold?: number;
}

/**
 * SemanticRecall stores LLM messages with their vector embeddings and
 * provides cosine-similarity search scoped to a thread.
 */
export class SemanticRecall {
  private readonly provider: EmbeddingProvider;
  private readonly embedFn: EmbeddingFunction;
  private readonly defaultTopK: number;
  private readonly threshold: number;

  constructor(params: SemanticRecallParams) {
    this.provider = params.provider;
    this.embedFn = params.embedFn;
    this.defaultTopK = params.topK ?? DEFAULT_TOP_K;
    this.threshold = params.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Embed and store a message entry under the given thread.
   */
  async store(threadId: string, entry: LLMMessage): Promise<void> {
    const entryId = this.provider.addEntry(threadId, entry);
    const vector = await this.embedFn(entry.content);
    this.provider.storeEmbedding(entryId, new Float64Array(vector));
  }

  /**
   * Embed the query, compute cosine similarity against all stored entries
   * for the thread, filter by threshold, and return top-K sorted by
   * descending score.
   */
  async search(threadId: string, query: string, topK?: number): Promise<SemanticSearchResult[]> {
    const k = topK ?? this.defaultTopK;
    const queryVec = new Float64Array(await this.embedFn(query));
    const entries = this.provider.loadEntries(threadId);

    const scored: SemanticSearchResult[] = [];
    for (const entry of entries) {
      const emb = this.provider.getEmbedding(entry.id);
      if (!emb) continue;
      const score = cosineSimilarity(queryVec, emb);
      if (score < this.threshold) continue;
      scored.push({ entry: entry.entry, score });
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    // Apply top-K limit
    return scored.slice(0, k);
  }
}
