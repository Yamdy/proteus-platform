import { describe, it, expect, beforeEach } from "vitest";
import { GlobalKnowledgeStore } from "./global-knowledge-store.js";

describe("GlobalKnowledgeStore", () => {
  let store: GlobalKnowledgeStore;

  beforeEach(() => {
    store = new GlobalKnowledgeStore();
  });

  describe("put + get", () => {
    it("should store and retrieve an entry by id", () => {
      const entry = store.put({
        key: "config/theme",
        value: { color: "dark" },
        tags: ["config", "ui"],
      });
      expect(entry.id).toBeTruthy();
      expect(entry.key).toBe("config/theme");
      expect(entry.value).toEqual({ color: "dark" });
      expect(entry.tags).toEqual(["config", "ui"]);
      expect(entry.createdAt).toBeGreaterThan(0);
      expect(entry.updatedAt).toBeGreaterThan(0);

      const retrieved = store.get(entry.id);
      expect(retrieved).toEqual(entry);
    });

    it("should return undefined for non-existent id", () => {
      expect(store.get("non-existent")).toBeUndefined();
    });

    it("should store entry with agentId and sessionId", () => {
      const entry = store.put({
        key: "shared/data",
        value: "hello",
        tags: ["shared"],
        agentId: "agent-a",
        sessionId: "session-1",
      });
      expect(entry.agentId).toBe("agent-a");
      expect(entry.sessionId).toBe("session-1");
    });
  });

  describe("query", () => {
    beforeEach(() => {
      store.put({ key: "config/theme", value: "dark", tags: ["config"] });
      store.put({ key: "config/lang", value: "en", tags: ["config"] });
      store.put({ key: "user/name", value: "Alice", tags: ["user"], agentId: "agent-a" });
      store.put({ key: "user/email", value: "alice@test.com", tags: ["user"], agentId: "agent-a" });
      store.put({ key: "shared/data", value: "shared-value", tags: ["shared"] });
    });

    it("should query by exact key", () => {
      const results = store.query({ key: "config/theme" });
      expect(results).toHaveLength(1);
      expect(results[0].value).toBe("dark");
    });

    it("should query by key prefix", () => {
      const results = store.query({ keyPrefix: "config/" });
      expect(results).toHaveLength(2);
    });

    it("should query by tags", () => {
      const results = store.query({ tags: ["user"] });
      expect(results).toHaveLength(2);
    });

    it("should query by multiple tags (AND)", () => {
      const store2 = new GlobalKnowledgeStore();
      store2.put({ key: "a", value: 1, tags: ["x", "y"] });
      store2.put({ key: "b", value: 2, tags: ["x"] });
      const results = store2.query({ tags: ["x", "y"] });
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe("a");
    });

    it("should query by agentId", () => {
      const results = store.query({ agentId: "agent-a" });
      expect(results).toHaveLength(2);
    });

    it("should apply limit", () => {
      const results = store.query({ keyPrefix: "config/", limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("should return all entries with empty query", () => {
      const results = store.query({});
      expect(results).toHaveLength(5);
    });

    it("should sort by updatedAt descending", () => {
      const results = store.query({});
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].updatedAt).toBeGreaterThanOrEqual(results[i].updatedAt);
      }
    });
  });

  describe("delete", () => {
    it("should delete an existing entry", () => {
      const entry = store.put({ key: "temp", value: 1, tags: [] });
      expect(store.delete(entry.id)).toBe(true);
      expect(store.get(entry.id)).toBeUndefined();
    });

    it("should return false for non-existent id", () => {
      expect(store.delete("non-existent")).toBe(false);
    });
  });

  describe("update", () => {
    it("should update value", () => {
      const entry = store.put({ key: "counter", value: 0, tags: [] });
      const updated = store.update(entry.id, { value: 1 });
      expect(updated).toBeDefined();
      expect(updated!.value).toBe(1);
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt);
    });

    it("should update tags", () => {
      const entry = store.put({ key: "item", value: "x", tags: ["old"] });
      const updated = store.update(entry.id, { tags: ["new"] });
      expect(updated!.tags).toEqual(["new"]);
    });

    it("should return undefined for non-existent id", () => {
      expect(store.update("non-existent", { value: 1 })).toBeUndefined();
    });
  });

  describe("size + clear", () => {
    it("should report size", () => {
      expect(store.size).toBe(0);
      store.put({ key: "a", value: 1, tags: [] });
      expect(store.size).toBe(1);
    });

    it("should clear all entries", () => {
      store.put({ key: "a", value: 1, tags: [] });
      store.put({ key: "b", value: 2, tags: [] });
      store.clear();
      expect(store.size).toBe(0);
    });
  });

  describe("cross-agent sharing", () => {
    it("should allow Agent A to write and Agent B to read", () => {
      // Agent A writes
      const entry = store.put({
        key: "shared/finding",
        value: { result: "critical bug in auth" },
        tags: ["analysis", "shared"],
        agentId: "agent-a",
      });

      // Agent B reads by querying shared tags
      const shared = store.query({ tags: ["shared"] });
      expect(shared).toHaveLength(1);
      expect(shared[0].value).toEqual({ result: "critical bug in auth" });
      expect(shared[0].agentId).toBe("agent-a");
    });
  });
});
