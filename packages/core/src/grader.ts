import type { EvalTask, GradeResult } from "./evaluation.js";
import type { LLMProvider } from "./types.js";

// --- Grader interface ---

export interface StringGrader {
  judge(task: EvalTask, actual: string): Promise<GradeResult>;
}

// --- ExactMatchGrader ---

export interface ExactMatchOptions {
  trim?: boolean;
  caseInsensitive?: boolean;
}

export class ExactMatchGrader implements StringGrader {
  readonly name = "ExactMatchGrader";
  private readonly trim: boolean;
  private readonly caseInsensitive: boolean;

  constructor(options?: ExactMatchOptions) {
    this.trim = options?.trim ?? false;
    this.caseInsensitive = options?.caseInsensitive ?? false;
  }

  async judge(task: EvalTask, actual: string): Promise<GradeResult> {
    if (task.expectedOutput === undefined) {
      return { pass: false, score: 0.0, reason: "no expectedOutput" };
    }

    let expected = task.expectedOutput;
    let actualStr = actual;

    if (this.trim) {
      expected = expected.trim();
      actualStr = actualStr.trim();
    }

    if (this.caseInsensitive) {
      expected = expected.toLowerCase();
      actualStr = actualStr.toLowerCase();
    }

    const match = expected === actualStr;
    return { pass: match, score: match ? 1.0 : 0.0 };
  }
}

// --- ContainsGrader ---

export class ContainsGrader implements StringGrader {
  readonly name = "ContainsGrader";
  private readonly keywords: string[];

  constructor(keywords: string[]) {
    this.keywords = keywords;
  }

  async judge(_task: EvalTask, actual: string): Promise<GradeResult> {
    if (this.keywords.length === 0) {
      return { pass: true, score: 1.0 };
    }

    let matchedCount = 0;
    for (const keyword of this.keywords) {
      if (actual.includes(keyword)) {
        matchedCount++;
      }
    }

    const score = matchedCount / this.keywords.length;
    return { pass: matchedCount === this.keywords.length, score };
  }
}

// --- LLMJudgeGrader ---

export interface LLMJudgeOptions {
  prompt?: string;
}

const DEFAULT_JUDGE_PROMPT =
  "You are a judge. Given the input and actual output, determine if the output is correct.\n\n" +
  "Input: {input}\nExpected: {expected}\nActual: {actual}\n\n" +
  "Respond with JSON: {\"pass\": boolean, \"score\": number, \"reason\": string}";

export class LLMJudgeGrader implements StringGrader {
  readonly name = "LLMJudgeGrader";
  private readonly llm: LLMProvider;
  private readonly prompt: string;

  constructor(llm: LLMProvider, options?: LLMJudgeOptions) {
    this.llm = llm;
    this.prompt = options?.prompt ?? DEFAULT_JUDGE_PROMPT;
  }

  async judge(task: EvalTask, actual: string): Promise<GradeResult> {
    const content = this.prompt
      .replace("{input}", task.input)
      .replace("{expected}", task.expectedOutput ?? "N/A")
      .replace("{actual}", actual);

    const response = await this.llm.chat(
      [{ role: "user", content }],
      [],
    );

    try {
      const parsed = JSON.parse(response.content);
      return {
        pass: Boolean(parsed.pass),
        score: Number(parsed.score) || 0,
        reason: String(parsed.reason ?? ""),
      };
    } catch {
      return { pass: false, score: 0.0, reason: "failed to parse LLM response" };
    }
  }
}
