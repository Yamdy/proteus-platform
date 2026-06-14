import type { CheckpointStore } from "./checkpoint-store.js";
import type { LLMProvider } from "./types.js";

// --- Type definitions ---

export interface EvalSuite {
  name: string;
  tasks: EvalTask[];
  graders: EvalGrader[];
  tags?: string[];
}

export interface EvalTask {
  id: string;
  input: string;
  expectedOutput?: string;
  tags?: string[];
}

export interface EvalGrader {
  name: string;
  judge(task: EvalTask, actual: string, trace?: unknown): Promise<GradeResult>;
}

export interface GradeResult {
  pass: boolean;
  score: number;
  reason?: string;
  attribution?: unknown;
}

export interface EvalReport {
  suite: EvalSuite;
  results: EvalTaskResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
  };
}

export interface EvalTaskResult {
  task: EvalTask;
  actual: string;
  grades: GradeResult[];
  trace?: unknown;
}

// --- Options ---

export interface EvaluationHarnessOptions {
  store: CheckpointStore;
  llm?: LLMProvider;
}

export interface RunSuiteOptions {
  tags?: string[];
}

// --- EvaluationHarness ---

export class EvaluationHarness {
  constructor(options: EvaluationHarnessOptions) {
    // Store and LLM provider for future use
    void options.store;
    void options.llm;
  }

  async runSuite(suite: EvalSuite, options?: RunSuiteOptions): Promise<EvalReport> {
    let tasks = suite.tasks;

    // Filter by tags if specified
    if (options?.tags && options.tags.length > 0) {
      const tagSet = new Set(options.tags);
      tasks = tasks.filter((t) => t.tags?.some((tag) => tagSet.has(tag)));
    }

    const results: EvalTaskResult[] = [];
    for (const t of tasks) {
      const result = await this.runTask(t, suite.graders);
      results.push(result);
    }

    const passed = results.filter((r) => r.grades.every((g) => g.pass)).length;
    const totalScore = results.reduce((sum, r) => {
      const avgGrade = r.grades.reduce((s, g) => s + g.score, 0) / r.grades.length;
      return sum + avgGrade;
    }, 0);

    return {
      suite,
      results,
      summary: {
        total: results.length,
        passed,
        failed: results.length - passed,
        avgScore: results.length > 0 ? totalScore / results.length : 0,
      },
    };
  }

  async runTask(task: EvalTask, graders: EvalGrader[]): Promise<EvalTaskResult> {
    // For skeleton: actual is empty string (real implementation would execute task)
    const actual = "";

    const grades: GradeResult[] = [];
    for (const grader of graders) {
      const grade = await grader.judge(task, actual);
      grades.push(grade);
    }

    return { task, actual, grades };
  }
}
