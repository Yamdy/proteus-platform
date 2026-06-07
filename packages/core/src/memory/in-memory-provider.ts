// @proteus-ai/core - In-memory MemoryProvider implementation

import type { MemoryProvider, MemoryEntry, WorkingMemoryData, MemoryThreadMeta } from "./types.js";

// --- InMemoryProvider ---

export class InMemoryProvider implements MemoryProvider {
  private threads = new Map<string, MemoryThreadMeta>();
  private history = new Map<string, MemoryEntry[]>();
  private workingMemory = new Map<string, WorkingMemoryData>();

  // --- History ---

  addEntry(threadId: string, entry: MemoryEntry): void {
    const entries = this.history.get(threadId) ?? [];
    entries.push({ ...entry });
    this.history.set(threadId, entries);
  }

  getHistory(threadId: string, limit?: number): MemoryEntry[] {
    const entries = this.history.get(threadId) ?? [];
    const copy = entries.map(e => ({ ...e }));
    if (limit !== undefined && limit >= 0) {
      return copy.slice(-limit);
    }
    return copy;
  }

  deleteEntry(threadId: string, entryId: string): void {
    const entries = this.history.get(threadId);
    if (!entries) return;
    const filtered = entries.filter(e => e.id !== entryId);
    this.history.set(threadId, filtered);
  }

  clearHistory(threadId: string): void {
    this.history.set(threadId, []);
  }

  // --- Working memory ---

  getWorkingMemory(threadId: string): WorkingMemoryData {
    const data = this.workingMemory.get(threadId);
    return data ? { ...data } : {};
  }

  setWorkingMemory(threadId: string, data: WorkingMemoryData): void {
    this.workingMemory.set(threadId, { ...data });
  }

  mergeWorkingMemory(threadId: string, partial: WorkingMemoryData): void {
    const existing = this.workingMemory.get(threadId) ?? {};
    this.workingMemory.set(threadId, { ...existing, ...partial });
  }

  // --- Threads ---

  createThread(meta: MemoryThreadMeta): void {
    const now = Date.now();
    this.threads.set(meta.threadId, {
      ...meta,
      createdAt: meta.createdAt ?? now,
      updatedAt: meta.updatedAt ?? now,
    });
  }

  getThread(threadId: string): MemoryThreadMeta | undefined {
    const meta = this.threads.get(threadId);
    return meta ? { ...meta } : undefined;
  }

  listThreads(sessionId?: string): MemoryThreadMeta[] {
    const all = [...this.threads.values()];
    if (sessionId !== undefined) {
      return all.filter(t => t.sessionId === sessionId).map(t => ({ ...t }));
    }
    return all.map(t => ({ ...t }));
  }

  deleteThread(threadId: string): void {
    this.threads.delete(threadId);
    this.history.delete(threadId);
    this.workingMemory.delete(threadId);
  }

  cloneThread(threadId: string, newMeta: Partial<MemoryThreadMeta> & { threadId: string }): MemoryThreadMeta | undefined {
    const existing = this.threads.get(threadId);
    if (!existing) return undefined;

    const now = Date.now();
    const cloned: MemoryThreadMeta = {
      ...existing,
      ...newMeta,
      createdAt: now,
      updatedAt: now,
    };
    this.threads.set(cloned.threadId, cloned);

    // Clone history
    const entries = this.history.get(threadId) ?? [];
    this.history.set(cloned.threadId, entries.map(e => ({ ...e })));

    // Clone working memory
    const wm = this.workingMemory.get(threadId);
    if (wm) {
      this.workingMemory.set(cloned.threadId, { ...wm });
    }

    return { ...cloned };
  }
}

// --- bindMethods (matches checkpoint-store pattern) ---

function bindMethods(instance: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
    if (key === "constructor") continue;
    const value = (instance as Record<string, unknown>)[key];
    if (typeof value === "function") {
      result[key] = value.bind(instance);
    }
  }
  return result;
}

export function createInMemoryProvider(): MemoryProvider {
  const provider = new InMemoryProvider();
  return bindMethods(provider) as unknown as MemoryProvider;
}
