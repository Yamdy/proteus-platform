import { describe, it, expect } from "vitest";
import { formatHierarchicalSpans } from "../span-utils.js";
import type { SpanRecord } from "../span-utils.js";

/** Helper to build a SpanRecord with sensible defaults. */
function span(overrides: Partial<SpanRecord> & { id: string }): SpanRecord {
  return {
    traceId: "trace-1",
    spanId: overrides.id,
    name: "span",
    type: "custom",
    status: "success",
    startTime: 0,
    endTime: 100,
    ...overrides,
  };
}

describe("formatHierarchicalSpans", () => {
  // -----------------------------------------------------------
  // 1. Empty input
  // -----------------------------------------------------------
  it("returns empty array for empty input", () => {
    expect(formatHierarchicalSpans([])).toEqual([]);
  });

  // -----------------------------------------------------------
  // 2. Single span — no children
  // -----------------------------------------------------------
  it("handles a single span with no children", () => {
    const spans: SpanRecord[] = [
      span({ id: "a", name: "root", startTime: 0, endTime: 50 }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
    expect(result[0].name).toBe("root");
    expect(result[0].latency).toBe(50);
    expect(result[0].spans).toEqual([]);
  });

  // -----------------------------------------------------------
  // 3. Basic tree — root + 2 children
  // -----------------------------------------------------------
  it("builds a basic tree with root and two children", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 100 }),
      span({ id: "c1", name: "child-1", startTime: 10, endTime: 40, parentSpanId: "root" }),
      span({ id: "c2", name: "child-2", startTime: 50, endTime: 90, parentSpanId: "root" }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("root");
    expect(result[0].spans).toHaveLength(2);
    expect(result[0].spans![0].id).toBe("c1");
    expect(result[0].spans![1].id).toBe("c2");
    expect(result[0].spans![0].latency).toBe(30);
    expect(result[0].spans![1].latency).toBe(40);
  });

  // -----------------------------------------------------------
  // 4. Deep nesting — root → child → grandchild
  // -----------------------------------------------------------
  it("handles deep nesting (root → child → grandchild)", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 100 }),
      span({ id: "child", name: "child", startTime: 10, endTime: 90, parentSpanId: "root" }),
      span({ id: "gc", name: "grandchild", startTime: 20, endTime: 80, parentSpanId: "child" }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result).toHaveLength(1);
    expect(result[0].spans).toHaveLength(1);
    expect(result[0].spans![0].spans).toHaveLength(1);
    expect(result[0].spans![0].spans![0].id).toBe("gc");
  });

  // -----------------------------------------------------------
  // 5. Orphan spans — parent not in map → surfaced as root
  // -----------------------------------------------------------
  it("surfaces orphan spans (missing parent) as roots", () => {
    const spans: SpanRecord[] = [
      span({ id: "orphan", name: "orphan", startTime: 0, endTime: 50, parentSpanId: "missing" }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("orphan");
    expect(result[0].spans).toEqual([]);
  });

  // -----------------------------------------------------------
  // 6. anchorSpanId — only subtree under anchor returned
  // -----------------------------------------------------------
  it("returns only the subtree when anchorSpanId is provided", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 200 }),
      span({ id: "anchor", name: "anchor", startTime: 10, endTime: 150, parentSpanId: "root" }),
      span({ id: "leaf", name: "leaf", startTime: 20, endTime: 100, parentSpanId: "anchor" }),
      span({ id: "sibling", name: "sibling", startTime: 160, endTime: 190, parentSpanId: "root" }),
    ];
    const result = formatHierarchicalSpans(spans, "anchor");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("anchor");
    expect(result[0].spans).toHaveLength(1);
    expect(result[0].spans![0].id).toBe("leaf");
  });

  it("returns empty array when anchorSpanId is not found", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 100 }),
    ];
    expect(formatHierarchicalSpans(spans, "nonexistent")).toEqual([]);
  });

  // -----------------------------------------------------------
  // 7. Sorting — children sorted by startTime ascending
  // -----------------------------------------------------------
  it("sorts children by startTime ascending", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 100 }),
      span({ id: "late", name: "late", startTime: 60, endTime: 90, parentSpanId: "root" }),
      span({ id: "early", name: "early", startTime: 10, endTime: 30, parentSpanId: "root" }),
      span({ id: "mid", name: "mid", startTime: 30, endTime: 50, parentSpanId: "root" }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result[0].spans!.map((s) => s.id)).toEqual(["early", "mid", "late"]);
  });

  // -----------------------------------------------------------
  // 8. Root endTime extension — root endTime extended to max descendant
  // -----------------------------------------------------------
  it("extends root endTime to max of all descendant endTime values", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 50 }),
      span({ id: "child", name: "child", startTime: 10, endTime: 200, parentSpanId: "root" }),
    ];
    const result = formatHierarchicalSpans(spans);
    // root.endTime (50) < child.endTime (200), so root should be extended
    expect(result[0].endTime).toBe(200);
    expect(result[0].latency).toBe(200);
  });

  it("does not shrink root endTime when descendants end earlier", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 100 }),
      span({ id: "child", name: "child", startTime: 10, endTime: 50, parentSpanId: "root" }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result[0].endTime).toBe(100);
  });

  // -----------------------------------------------------------
  // 9. UISpan type correctness
  // -----------------------------------------------------------
  it("maps SpanRecord fields to UISpan correctly", () => {
    const spans: SpanRecord[] = [
      span({ id: "s1", name: "test-span", type: "llm", startTime: 100, endTime: 250 }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result[0]).toEqual({
      id: "s1",
      name: "test-span",
      type: "llm",
      latency: 150,
      startTime: 100,
      endTime: 250,
      spans: [],
    });
  });

  it("preserves parentSpanId in output", () => {
    const spans: SpanRecord[] = [
      span({ id: "root", name: "root", startTime: 0, endTime: 100 }),
      span({ id: "child", name: "child", startTime: 10, endTime: 50, parentSpanId: "root" }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result[0].parentSpanId).toBeUndefined();
    expect(result[0].spans![0].parentSpanId).toBe("root");
  });

  // -----------------------------------------------------------
  // 10. Multiple roots
  // -----------------------------------------------------------
  it("handles multiple independent roots", () => {
    const spans: SpanRecord[] = [
      span({ id: "r1", name: "root-1", startTime: 0, endTime: 50 }),
      span({ id: "r2", name: "root-2", startTime: 60, endTime: 100 }),
    ];
    const result = formatHierarchicalSpans(spans);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("r1");
    expect(result[1].id).toBe("r2");
  });
});
