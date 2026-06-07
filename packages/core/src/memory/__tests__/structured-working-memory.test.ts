import { describe, it, expect, beforeEach } from "vitest";
import { StructuredWorkingMemory } from "../structured-working-memory.js";

// --- Tests ---

describe("StructuredWorkingMemory", () => {
  let mem: StructuredWorkingMemory;

  beforeEach(() => {
    mem = new StructuredWorkingMemory({
      template: "User preferences: {{name}}, {{language}}, Task: {{currentTask}}",
    });
  });

  // --- get ---

  describe("get", () => {
    it("returns empty object for a thread with no prior data", () => {
      expect(mem.get("t1")).toEqual({});
    });

    it("returns the stored state after update", () => {
      mem.update("t1", { name: "Alice", language: "en" });
      expect(mem.get("t1")).toEqual({ name: "Alice", language: "en" });
    });

    it("returns independent copies for different threads", () => {
      mem.update("t1", { name: "Alice" });
      mem.update("t2", { name: "Bob" });

      expect(mem.get("t1")).toEqual({ name: "Alice" });
      expect(mem.get("t2")).toEqual({ name: "Bob" });
    });
  });

  // --- update ---

  describe("update", () => {
    it("replaces entire state for a thread", () => {
      mem.update("t1", { name: "Alice", language: "en" });
      mem.update("t1", { currentTask: "review" });

      expect(mem.get("t1")).toEqual({ currentTask: "review" });
    });

    it("does not affect other threads", () => {
      mem.update("t1", { name: "Alice" });
      mem.update("t2", { name: "Bob" });
      mem.update("t1", { name: "Charlie" });

      expect(mem.get("t2")).toEqual({ name: "Bob" });
    });
  });

  // --- merge ---

  describe("merge", () => {
    it("merges partial data into existing state", () => {
      mem.update("t1", { name: "Alice", language: "en" });
      mem.merge("t1", { currentTask: "review" });

      expect(mem.get("t1")).toEqual({
        name: "Alice",
        language: "en",
        currentTask: "review",
      });
    });

    it("overwrites existing keys on merge", () => {
      mem.update("t1", { name: "Alice", language: "en" });
      mem.merge("t1", { language: "fr" });

      expect(mem.get("t1")).toEqual({ name: "Alice", language: "fr" });
    });

    it("creates state if thread has no prior data", () => {
      mem.merge("t1", { name: "Alice" });

      expect(mem.get("t1")).toEqual({ name: "Alice" });
    });

    it("preserves existing keys not present in partial", () => {
      mem.update("t1", { name: "Alice", language: "en", currentTask: "review" });
      mem.merge("t1", { currentTask: "deploy" });

      expect(mem.get("t1")).toEqual({
        name: "Alice",
        language: "en",
        currentTask: "deploy",
      });
    });
  });

  // --- getFormatted ---

  describe("getFormatted", () => {
    it("renders template with all keys present", () => {
      mem.update("t1", { name: "Alice", language: "en", currentTask: "review" });

      expect(mem.getFormatted("t1")).toBe(
        "User preferences: Alice, en, Task: review",
      );
    });

    it("renders missing keys as empty string", () => {
      mem.update("t1", { name: "Alice" });

      expect(mem.getFormatted("t1")).toBe(
        "User preferences: Alice, , Task: ",
      );
    });

    it("renders all placeholders as empty string when state is empty", () => {
      expect(mem.getFormatted("t1")).toBe(
        "User preferences: , , Task: ",
      );
    });

    it("works with an empty template", () => {
      const emptyMem = new StructuredWorkingMemory({ template: "" });
      emptyMem.update("t1", { name: "Alice" });

      expect(emptyMem.getFormatted("t1")).toBe("");
    });

    it("handles repeated placeholders independently", () => {
      const repeated = new StructuredWorkingMemory({
        template: "{{name}} said {{name}}",
      });
      repeated.update("t1", { name: "Alice" });

      expect(repeated.getFormatted("t1")).toBe("Alice said Alice");
    });
  });

  // --- maxTokens (optional guard) ---

  describe("maxTokens", () => {
    it("throws when formatted output exceeds maxTokens", () => {
      const limited = new StructuredWorkingMemory({
        template: "{{data}}",
        maxTokens: 5,
      });
      limited.update("t1", { data: "a".repeat(100) });

      expect(() => limited.getFormatted("t1")).toThrow(/maxTokens/);
    });

    it("does not throw when formatted output is within maxTokens", () => {
      const limited = new StructuredWorkingMemory({
        template: "{{data}}",
        maxTokens: 100,
      });
      limited.update("t1", { data: "short" });

      expect(limited.getFormatted("t1")).toBe("short");
    });
  });

  // --- isolation ---

  describe("thread isolation", () => {
    it("get returns independent object (mutation does not affect store)", () => {
      mem.update("t1", { name: "Alice" });
      const snapshot = mem.get("t1");
      snapshot.name = "mutated";

      expect(mem.get("t1")).toEqual({ name: "Alice" });
    });
  });
});
