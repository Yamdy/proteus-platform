import { describe, it, expect } from "vitest";
import { EvaluationHarness } from "./evaluation.js";
import type { EvalSuite, EvalTask, EvalGrader } from "./evaluation.js";
import { createInMemoryStore } from "./checkpoint-store.js";

// --- Test helpers ---

function stubGrader(pass: boolean, score: number): EvalGrader {
  return {
    name: "stub",
    judge: async () => ({ pass, score }),
  };
}

function suite(tasks: EvalTask[], graders: EvalGrader[] = [stubGrader(true, 1.0)]): EvalSuite {
  return { name: "test-suite", tasks, graders };
}

function task(id: string, input: string, expected?: string, tags?: string[]): EvalTask {
  return { id, input, expectedOutput: expected, tags };
}

// --- Tests ---

describe("EvaluationHarness", () => {
  it("runTask returns correct EvalTaskResult structure", async () => {
    const harness = new EvaluationHarness({ store: createInMemoryStore() });
    const t = task("t1", "q1", "a1");
    const result = await harness.runTask(t, [stubGrader(true, 1.0)]);

    expect(result.task).toBe(t);
    expect(result.actual).toBe("");
    expect(result.grades).toHaveLength(1);
    expect(result.grades[0]).toEqual({ pass: true, score: 1.0 });
  });

  it("runSuite returns correct EvalReport", async () => {
    const harness = new EvaluationHarness({ store: createInMemoryStore() });
    const s = suite([
      task("t1", "q1", "a1"),
      task("t2", "q2", "a2"),
    ]);
    const report = await harness.runSuite(s);

    expect(report.suite).toBe(s);
    expect(report.results).toHaveLength(2);
    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.avgScore).toBe(1.0);
  });

  it("runSuite calculates correct summary for mixed results", async () => {
    const harness = new EvaluationHarness({ store: createInMemoryStore() });
    const s = suite(
      [task("t1", "q1", "a1"), task("t2", "q2", "a2")],
      [stubGrader(false, 0.0)],
    );
    const report = await harness.runSuite(s);

    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(2);
    expect(report.summary.avgScore).toBe(0.0);
  });

  it("runSuite filters tasks by tag", async () => {
    const harness = new EvaluationHarness({ store: createInMemoryStore() });
    const s = suite([
      task("t1", "q1", "a1", ["fast"]),
      task("t2", "q2", "a2", ["slow"]),
      task("t3", "q3", "a3", ["fast"]),
    ]);
    const report = await harness.runSuite(s, { tags: ["fast"] });

    expect(report.results).toHaveLength(2);
    expect(report.summary.total).toBe(2);
  });

  it("runTask uses all graders", async () => {
    const harness = new EvaluationHarness({ store: createInMemoryStore() });
    const graders = [stubGrader(true, 1.0), stubGrader(false, 0.5)];
    const result = await harness.runTask(task("t1", "q1", "a1"), graders);

    expect(result.grades).toHaveLength(2);
    expect(result.grades[0].pass).toBe(true);
    expect(result.grades[1].pass).toBe(false);
  });
});
