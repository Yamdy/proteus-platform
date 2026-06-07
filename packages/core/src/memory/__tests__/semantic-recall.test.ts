import { describe, it, expect, beforeEach } from "vitest";
import { SemanticRecall } from "../semantic-recall.js";
import { InMemoryEmbeddingProvider } from "../in-memory-embedding-provider.js";
import type { EmbeddingProvider, EmbeddingFunction } from "../types.js";
import type { LLMMessage } from "../../types.js";

// --- Deterministic synthetic embedding function ---
const DIMENSION = 32;

function syntheticEmbed(text: string): number[] {
  const vec = new Array<number>(DIMENSION).fill(0);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    vec[i % DIMENSION] += (code % 97) + 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  return vec;
}

const syntheticEmbedFn: EmbeddingFunction = async (text: string) => syntheticEmbed(text);

function makeMsg(content: string): LLMMessage {
  return { role: "user", content };
}

describe("SemanticRecall", () => {
  let provider: EmbeddingProvider;
  let recall: SemanticRecall;

  beforeEach(() => {
    provider = new InMemoryEmbeddingProvider();
    recall = new SemanticRecall({
      provider,
      embedFn: syntheticEmbedFn,
      topK: 5,
      threshold: 0,
    });
  });

  describe("store + search round-trip", () => {
    it("stores an entry and retrieves it via search", async () => {
      await recall.store("t1", makeMsg("hello world"));
      const results = await recall.search("t1", "hello world");
      expect(results).toHaveLength(1);
      expect(results[0].entry.content).toBe("hello world");
      expect(results[0].score).toBeGreaterThan(0.99);
    });

    it("stores multiple entries and retrieves all for the thread", async () => {
      await recall.store("t1", makeMsg("alpha"));
      await recall.store("t1", makeMsg("beta"));
      await recall.store("t1", makeMsg("gamma"));
      const results = await recall.search("t1", "alpha");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entry.content).toBe("alpha");
    });

    it("does not return entries from a different thread", async () => {
      await recall.store("t1", makeMsg("hello"));
      await recall.store("t2", makeMsg("hello"));
      const results = await recall.search("t1", "hello");
      expect(results).toHaveLength(1);
    });
  });

  describe("top-K ordering", () => {
    it("returns results sorted by descending score", async () => {
      await recall.store("t1", makeMsg("cats are wonderful"));
      await recall.store("t1", makeMsg("dogs are loyal"));
      await recall.store("t1", makeMsg("cats are furry"));
      const results = await recall.search("t1", "cats");
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("respects topK limit from constructor", async () => {
      const smallRecall = new SemanticRecall({
        provider,
        embedFn: syntheticEmbedFn,
        topK: 2,
        threshold: 0,
      });
      await smallRecall.store("t1", makeMsg("one"));
      await smallRecall.store("t1", makeMsg("two"));
      await smallRecall.store("t1", makeMsg("three"));
      const results = await smallRecall.search("t1", "one two three");
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("respects topK parameter passed to search over constructor default", async () => {
      const overrideRecall = new SemanticRecall({
        provider,
        embedFn: syntheticEmbedFn,
        topK: 10,
        threshold: 0,
      });
      await overrideRecall.store("t1", makeMsg("alpha"));
      await overrideRecall.store("t1", makeMsg("beta"));
      await overrideRecall.store("t1", makeMsg("gamma"));
      const results = await overrideRecall.search("t1", "alpha beta gamma", 1);
      expect(results).toHaveLength(1);
    });
  });

  describe("threshold filtering", () => {
    it("excludes results below the score threshold", async () => {
      const strictRecall = new SemanticRecall({
        provider,
        embedFn: syntheticEmbedFn,
        topK: 10,
        threshold: 0.99,
      });
      await strictRecall.store("t1", makeMsg("hello world"));
      const results = await strictRecall.search("t1", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.99);
      }
    });

    it("includes results above the threshold", async () => {
      const lenientRecall = new SemanticRecall({
        provider,
        embedFn: syntheticEmbedFn,
        topK: 10,
        threshold: 0.1,
      });
      await lenientRecall.store("t1", makeMsg("hello"));
      const results = await lenientRecall.search("t1", "hello");
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe("empty results", () => {
    it("returns empty array when no entries exist for the thread", async () => {
      const results = await recall.search("empty-thread", "hello");
      expect(results).toEqual([]);
    });

    it("filters out all results when threshold is very high", async () => {
      const strictRecall = new SemanticRecall({
        provider,
        embedFn: syntheticEmbedFn,
        topK: 10,
        threshold: 0.9999,
      });
      await strictRecall.store("t1", makeMsg("aaa"));
      const results = await strictRecall.search("t1", "zzzzzzzzzzzzzzzzzzzzzz");
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0.9999);
      }
    });
  });

  describe("cosine similarity", () => {
    it("identical texts produce score of 1.0", async () => {
      await recall.store("t1", makeMsg("exact match test"));
      const results = await recall.search("t1", "exact match test");
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it("different texts produce different scores", async () => {
      await recall.store("t1", makeMsg("abc"));
      await recall.store("t1", makeMsg("xyz"));
      const results = await recall.search("t1", "abc");
      expect(results).toHaveLength(2);
      expect(results[0].entry.content).toBe("abc");
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });
  });
});

describe("InMemoryEmbeddingProvider", () => {
  let p: EmbeddingProvider;

  beforeEach(() => {
    p = new InMemoryEmbeddingProvider();
  });

  it("storeEmbedding and getEmbedding round-trip", () => {
    const id = p.addEntry("t1", makeMsg("test"));
    const vec = new Float64Array([1, 2, 3]);
    p.storeEmbedding(id, vec);
    const loaded = p.getEmbedding(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(3);
    expect(loaded![0]).toBe(1);
    expect(loaded![1]).toBe(2);
    expect(loaded![2]).toBe(3);
  });

  it("getEmbedding returns null for unknown entryId", () => {
    expect(p.getEmbedding("nonexistent")).toBeNull();
  });

  it("loadEntries returns entries scoped to thread", () => {
    p.addEntry("t1", makeMsg("a"));
    p.addEntry("t2", makeMsg("b"));
    const t1Entries = p.loadEntries("t1");
    expect(t1Entries).toHaveLength(1);
    expect(t1Entries[0].entry.content).toBe("a");
  });

  it("loadEntries returns empty array for unknown thread", () => {
    expect(p.loadEntries("unknown")).toEqual([]);
  });
});
