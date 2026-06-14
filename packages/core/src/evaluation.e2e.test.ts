import { describe, it, expect } from "vitest";
import { EvaluationHarness } from "./evaluation.js";
import { ExactMatchGrader, ContainsGrader } from "./grader.js";
import type { EvalSuite } from "./evaluation.js";

describe("EvaluationHarness E2E", () => {
  // Minimal CheckpointStore stub — EvaluationHarness doesn't use it yet
  const mockStore = {} as any;

  const harness = new EvaluationHarness({ store: mockStore });

  // --- Test 1: ExactMatchGrader ---
  // runTask skeleton returns "" as actual.
  // Task with expectedOutput="" matches; others fail.
  it("runs a suite with ExactMatchGrader", async () => {
    const suite: EvalSuite = {
      name: "exact-match-suite",
      tasks: [
        { id: "t1", input: "hello", expectedOutput: "" },   // matches ""
        { id: "t2", input: "world", expectedOutput: "foo" }, // does not match ""
        { id: "t3", input: "baz" },                          // no expectedOutput → fail
      ],
      graders: [new ExactMatchGrader()],
    };

    const report = await harness.runSuite(suite);

    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(2);

    // t1 passes (expected "" == actual "")
    expect(report.results[0].grades[0].pass).toBe(true);
    expect(report.results[0].grades[0].score).toBe(1.0);

    // t2 fails (expected "foo" != actual "")
    expect(report.results[1].grades[0].pass).toBe(false);
    expect(report.results[1].grades[0].score).toBe(0.0);

    // t3 fails (no expectedOutput)
    expect(report.results[2].grades[0].pass).toBe(false);
    expect(report.results[2].grades[0].score).toBe(0.0);
    expect(report.results[2].grades[0].reason).toBe("no expectedOutput");

    // avgScore: (1.0 + 0.0 + 0.0) / 3
    expect(report.summary.avgScore).toBeCloseTo(1.0 / 3);
  });

  // --- Test 2: ContainsGrader ---
  // Since actual is "", no non-empty keyword can be found.
  it("runs a suite with ContainsGrader", async () => {
    const suite: EvalSuite = {
      name: "contains-suite",
      tasks: [
        { id: "t1", input: "a" },
        { id: "t2", input: "b" },
      ],
      graders: [new ContainsGrader(["hello", "world"])],
    };

    const report = await harness.runSuite(suite);

    expect(report.summary.total).toBe(2);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(2);

    // "" does not contain "hello" or "world" → score 0
    for (const result of report.results) {
      expect(result.grades[0].pass).toBe(false);
      expect(result.grades[0].score).toBe(0.0);
    }

    expect(report.summary.avgScore).toBe(0.0);
  });

  // ContainsGrader with empty keywords always passes
  it("ContainsGrader with empty keywords passes", async () => {
    const suite: EvalSuite = {
      name: "contains-empty-suite",
      tasks: [{ id: "t1", input: "a" }],
      graders: [new ContainsGrader([])],
    };

    const report = await harness.runSuite(suite);

    expect(report.summary.total).toBe(1);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.results[0].grades[0].pass).toBe(true);
    expect(report.results[0].grades[0].score).toBe(1.0);
  });

  // --- Test 3: Tag filtering ---
  it("filters tasks by tags", async () => {
    const suite: EvalSuite = {
      name: "tagged-suite",
      tasks: [
        { id: "t1", input: "a", expectedOutput: "", tags: ["fast"] },
        { id: "t2", input: "b", expectedOutput: "x", tags: ["slow"] },
        { id: "t3", input: "c", expectedOutput: "", tags: ["fast", "slow"] },
        { id: "t4", input: "d", expectedOutput: "" },  // no tags
      ],
      graders: [new ExactMatchGrader()],
    };

    const report = await harness.runSuite(suite, { tags: ["fast"] });

    // Only t1 and t3 have the "fast" tag
    expect(report.summary.total).toBe(2);
    expect(report.results.map((r) => r.task.id)).toEqual(["t1", "t3"]);

    // t1 passes (expected "" == actual ""), t3 passes too
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
  });

  // Tag filter with non-matching tag returns empty report
  it("returns empty report when no tasks match tags", async () => {
    const suite: EvalSuite = {
      name: "tagged-suite-empty",
      tasks: [
        { id: "t1", input: "a", tags: ["fast"] },
      ],
      graders: [new ExactMatchGrader()],
    };

    const report = await harness.runSuite(suite, { tags: ["nonexistent"] });

    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.results).toHaveLength(0);
  });

  // --- Test 4: Multiple graders ---
  it("runs a suite with multiple graders", async () => {
    const suite: EvalSuite = {
      name: "multi-grader-suite",
      tasks: [
        { id: "t1", input: "a", expectedOutput: "" },
        { id: "t2", input: "b", expectedOutput: "foo" },
      ],
      graders: [
        new ExactMatchGrader(),
        new ContainsGrader(["x"]),
      ],
    };

    const report = await harness.runSuite(suite);

    expect(report.summary.total).toBe(2);

    // Each task should have 2 grades
    for (const result of report.results) {
      expect(result.grades).toHaveLength(2);
    }

    // t1: ExactMatch passes ("" == ""), Contains fails ("" lacks "x")
    expect(report.results[0].grades[0].pass).toBe(true);  // ExactMatch
    expect(report.results[0].grades[0].score).toBe(1.0);
    expect(report.results[0].grades[1].pass).toBe(false);  // Contains
    expect(report.results[0].grades[1].score).toBe(0.0);

    // t2: ExactMatch fails ("foo" != ""), Contains fails ("" lacks "x")
    expect(report.results[1].grades[0].pass).toBe(false);  // ExactMatch
    expect(report.results[1].grades[0].score).toBe(0.0);
    expect(report.results[1].grades[1].pass).toBe(false);  // Contains
    expect(report.results[1].grades[1].score).toBe(0.0);

    // A task passes only if ALL graders pass → both tasks fail
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(2);

    // avgScore per task: average of its grades' scores
    // t1: (1.0 + 0.0) / 2 = 0.5
    // t2: (0.0 + 0.0) / 2 = 0.0
    // avgScore: (0.5 + 0.0) / 2 = 0.25
    expect(report.summary.avgScore).toBeCloseTo(0.25);
  });

  // --- Test 5: Empty suite ---
  it("handles an empty suite", async () => {
    const suite: EvalSuite = {
      name: "empty-suite",
      tasks: [],
      graders: [new ExactMatchGrader()],
    };

    const report = await harness.runSuite(suite);

    expect(report.summary.total).toBe(0);
    expect(report.summary.passed).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.avgScore).toBe(0);
    expect(report.results).toHaveLength(0);
    expect(report.suite).toBe(suite);
  });
});
