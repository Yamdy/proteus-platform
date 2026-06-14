import { describe, it, expect } from "vitest";
import { ExactMatchGrader, ContainsGrader, LLMJudgeGrader } from "./grader.js";
import type { EvalTask } from "./evaluation.js";
import type { LLMProvider, LLMResponse } from "./types.js";

// --- Test helpers ---

function task(input: string, expected?: string): EvalTask {
  return { id: "t1", input, expectedOutput: expected };
}

// --- ExactMatchGrader ---

describe("ExactMatchGrader", () => {
  it("returns pass=true, score=1.0 for exact match", async () => {
    const grader = new ExactMatchGrader();
    const result = await grader.judge(task("q", "hello"), "hello");
    expect(result).toEqual({ pass: true, score: 1.0 });
  });

  it("returns pass=false, score=0.0 for mismatch", async () => {
    const grader = new ExactMatchGrader();
    const result = await grader.judge(task("q", "hello"), "world");
    expect(result).toEqual({ pass: false, score: 0.0 });
  });

  it("trims whitespace when trim=true", async () => {
    const grader = new ExactMatchGrader({ trim: true });
    const result = await grader.judge(task("q", "  hello  "), "hello");
    expect(result).toEqual({ pass: true, score: 1.0 });
  });

  it("ignores case when caseInsensitive=true", async () => {
    const grader = new ExactMatchGrader({ caseInsensitive: true });
    const result = await grader.judge(task("q", "Hello"), "hello");
    expect(result).toEqual({ pass: true, score: 1.0 });
  });

  it("combines trim and caseInsensitive", async () => {
    const grader = new ExactMatchGrader({ trim: true, caseInsensitive: true });
    const result = await grader.judge(task("q", "  HELLO  "), "hello");
    expect(result).toEqual({ pass: true, score: 1.0 });
  });
});

// --- ContainsGrader ---

describe("ContainsGrader", () => {
  it("returns pass=true when all keywords present", async () => {
    const grader = new ContainsGrader(["hello", "world"]);
    const result = await grader.judge(task("q"), "hello world foo");
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("returns pass=false when some keywords missing", async () => {
    const grader = new ContainsGrader(["hello", "world", "foo"]);
    const result = await grader.judge(task("q"), "hello world");
    expect(result.pass).toBe(false);
    expect(result.score).toBeCloseTo(2 / 3);
  });

  it("returns pass=false, score=0 when no keywords present", async () => {
    const grader = new ContainsGrader(["foo", "bar"]);
    const result = await grader.judge(task("q"), "hello world");
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0.0);
  });

  it("handles empty keywords array", async () => {
    const grader = new ContainsGrader([]);
    const result = await grader.judge(task("q"), "anything");
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

// --- LLMJudgeGrader ---

function stubLLM(response: Partial<LLMResponse> = {}): LLMProvider {
  return {
    chat: async () => ({
      content: JSON.stringify({ pass: true, score: 1.0, reason: "correct" }),
      finishReason: "stop" as const,
      usage: { promptTokens: 10, completionTokens: 5 },
      ...response,
    }),
    chatStream: async function* () {},
    countTokens: () => 10,
  };
}

describe("LLMJudgeGrader", () => {
  it("uses LLM to grade output", async () => {
    const llm = stubLLM({ content: JSON.stringify({ pass: true, score: 1.0, reason: "correct answer" }) });
    const grader = new LLMJudgeGrader(llm);
    const result = await grader.judge(task("What is 2+2?", "4"), "4");
    expect(result.pass).toBe(true);
    expect(result.score).toBe(1.0);
    expect(result.reason).toBe("correct answer");
  });

  it("sends task.input and actual to LLM", async () => {
    let capturedMessages: unknown[] = [];
    const llm: LLMProvider = {
      chat: async (messages) => {
        capturedMessages = messages;
        return { content: JSON.stringify({ pass: true, score: 1.0, reason: "ok" }), finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } };
      },
      chatStream: async function* () {},
      countTokens: () => 10,
    };
    const grader = new LLMJudgeGrader(llm);
    await grader.judge(task("What is 2+2?"), "4");
    expect(capturedMessages.length).toBeGreaterThan(0);
  });

  it("supports custom judge prompt", async () => {
    let capturedMessages: unknown[] = [];
    const llm: LLMProvider = {
      chat: async (messages) => {
        capturedMessages = messages;
        return { content: JSON.stringify({ pass: true, score: 1.0, reason: "ok" }), finishReason: "stop", usage: { promptTokens: 10, completionTokens: 5 } };
      },
      chatStream: async function* () {},
      countTokens: () => 10,
    };
    const grader = new LLMJudgeGrader(llm, { prompt: "Custom prompt: {input} vs {actual}" });
    await grader.judge(task("q1"), "a1");
    expect(capturedMessages[0]).toHaveProperty("content", "Custom prompt: q1 vs a1");
  });

  it("handles LLM returning non-JSON gracefully", async () => {
    const llm = stubLLM({ content: "not json" });
    const grader = new LLMJudgeGrader(llm);
    const result = await grader.judge(task("q"), "a");
    expect(result.pass).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.reason).toContain("parse");
  });
});
