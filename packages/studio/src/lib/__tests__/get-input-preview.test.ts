import { describe, it, expect } from "vitest";
import { getInputPreview } from "../get-input-preview";

describe("getInputPreview", () => {
  it("returns string input truncated to 80 chars", () => {
    const long = "a".repeat(120);
    const result = getInputPreview(long);
    expect(result).toBe("a".repeat(80));
  });

  it("returns short string as-is", () => {
    expect(getInputPreview("hello world")).toBe("hello world");
  });

  it("returns empty string for empty string input", () => {
    expect(getInputPreview("")).toBe("");
  });

  it("extracts first user message from messages array", () => {
    const input = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "What is the weather?" },
      { role: "assistant", content: "It is sunny." },
    ];
    expect(getInputPreview(input)).toBe("What is the weather?");
  });

  it("truncates user message content to 80 chars", () => {
    const longContent = "x".repeat(120);
    const input = [{ role: "user", content: longContent }];
    expect(getInputPreview(input)).toBe("x".repeat(80));
  });

  it("falls back to first item content if no user message", () => {
    const input = [
      { role: "system", content: "System prompt here" },
      { role: "assistant", content: "Assistant reply" },
    ];
    expect(getInputPreview(input)).toBe("System prompt here");
  });

  it("extracts content from object with content field", () => {
    const input = { content: "Some content value" };
    expect(getInputPreview(input)).toBe("Some content value");
  });

  it("truncates object content to 80 chars", () => {
    const input = { content: "z".repeat(100) };
    expect(getInputPreview(input)).toBe("z".repeat(80));
  });

  it("stringifies unknown objects as fallback", () => {
    const input = { foo: "bar", baz: 42 };
    const result = getInputPreview(input);
    expect(result).toContain("foo");
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("handles null input", () => {
    expect(getInputPreview(null)).toBe("null");
  });

  it("handles undefined input", () => {
    expect(getInputPreview(undefined)).toBe("undefined");
  });

  it("handles number input", () => {
    expect(getInputPreview(42)).toBe("42");
  });

  it("handles empty messages array", () => {
    expect(getInputPreview([])).toBe("[]");
  });

  it("handles messages with non-string content", () => {
    const input = [{ role: "user", content: { type: "text", text: "hello" } }];
    const result = getInputPreview(input);
    expect(result).toContain("hello");
  });
});
