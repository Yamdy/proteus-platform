import { randomUUID } from "node:crypto";
import type { KnowledgeEntry, KnowledgeQuery, KnowledgeStore } from "../types.js";

/**
 * In-memory implementation of KnowledgeStore.
 * Shared across agents and sessions within a single process.
 */
export class GlobalKnowledgeStore implements KnowledgeStore {
  private readonly entries = new Map<string, KnowledgeEntry>();

  put(
    entry: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt">,
  ): KnowledgeEntry {
    const now = Date.now();
    const full: KnowledgeEntry = {
      ...entry,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(full.id, full);
    return full;
  }

  get(id: string): KnowledgeEntry | undefined {
    return this.entries.get(id);
  }

  query(q: KnowledgeQuery): KnowledgeEntry[] {
    let results = [...this.entries.values()];

    if (q.key !== undefined) {
      results = results.filter((e) => e.key === q.key);
    }
    if (q.keyPrefix !== undefined) {
      results = results.filter((e) => e.key.startsWith(q.keyPrefix!));
    }
    if (q.tags && q.tags.length > 0) {
      results = results.filter((e) => q.tags!.every((t) => e.tags.includes(t)));
    }
    if (q.agentId !== undefined) {
      results = results.filter((e) => e.agentId === q.agentId);
    }

    // Sort by updatedAt descending (most recent first)
    results.sort((a, b) => b.updatedAt - a.updatedAt);

    if (q.limit !== undefined && q.limit > 0) {
      results = results.slice(0, q.limit);
    }

    return results;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  update(
    id: string,
    patch: Partial<Pick<KnowledgeEntry, "value" | "tags">>,
  ): KnowledgeEntry | undefined {
    const existing = this.entries.get(id);
    if (!existing) return undefined;

    const updated: KnowledgeEntry = {
      ...existing,
      ...(patch.value !== undefined && { value: patch.value }),
      ...(patch.tags !== undefined && { tags: patch.tags }),
      updatedAt: Date.now(),
    };
    this.entries.set(id, updated);
    return updated;
  }

  /** Number of entries in the store. */
  get size(): number {
    return this.entries.size;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries.clear();
  }
}
