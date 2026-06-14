import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TraceTimeline } from "../TraceTimeline";
import type { TraceSpan } from "../../../hooks/useObservability";

// --- Test data factories ---

function makeSpan(overrides: Partial<TraceSpan> & { type?: string } = {}): TraceSpan & { type?: string } {
  return {
    id: "span-1",
    traceId: "trace-1",
    name: "llm:chat",
    startTime: 1000,
    endTime: 1500,
    duration: 500,
    status: "ok",
    ...overrides,
  };
}

/** Flat list of root spans (no parent-child) — for basic rendering tests. */
function makeFlatSpans(): (TraceSpan & { type?: string })[] {
  return [
    makeSpan({ id: "s1", name: "turn:execute", startTime: 1000, endTime: 3000, duration: 2000 }),
    makeSpan({ id: "s2", name: "llm:chat", startTime: 1100, endTime: 2000, duration: 900 }),
    makeSpan({ id: "s3", name: "tool:run", startTime: 2100, endTime: 2800, duration: 700 }),
  ];
}

/** Simple tree: root with 2 children. */
function makeSimpleTrace(): (TraceSpan & { type?: string })[] {
  return [
    makeSpan({ id: "root", name: "turn:execute", startTime: 1000, endTime: 3000, duration: 2000 }),
    makeSpan({ id: "child-1", parentSpanId: "root", name: "llm:chat", startTime: 1100, endTime: 2000, duration: 900 }),
    makeSpan({ id: "child-2", parentSpanId: "root", name: "tool:run", startTime: 2100, endTime: 2800, duration: 700 }),
  ];
}

/** Deep tree: root -> child-a -> grandchild-a1, grandchild-a2 -> great-grandchild; root -> child-b -> grandchild-b1. */
function makeDeepTrace(): (TraceSpan & { type?: string })[] {
  return [
    makeSpan({ id: "root", name: "chain:run", startTime: 0, endTime: 5000, duration: 5000 }),
    makeSpan({ id: "child-a", parentSpanId: "root", name: "turn:1", startTime: 100, endTime: 3000, duration: 2900 }),
    makeSpan({ id: "grandchild-a1", parentSpanId: "child-a", name: "llm:chat", startTime: 200, endTime: 1500, duration: 1300 }),
    makeSpan({ id: "grandchild-a2", parentSpanId: "child-a", name: "tool:search", startTime: 1600, endTime: 2800, duration: 1200 }),
    makeSpan({ id: "great-grandchild", parentSpanId: "grandchild-a2", name: "context:load", startTime: 1700, endTime: 2000, duration: 300 }),
    makeSpan({ id: "child-b", parentSpanId: "root", name: "turn:2", startTime: 3100, endTime: 4800, duration: 1700 }),
    makeSpan({ id: "grandchild-b1", parentSpanId: "child-b", name: "llm:stream", startTime: 3200, endTime: 4600, duration: 1400 }),
  ];
}

// --- Tests ---

describe("TraceTimeline", () => {
  describe("basic rendering", () => {
    it("renders without crashing with empty spans", () => {
      render(<TraceTimeline spans={[]} />);
      expect(screen.getByTestId("trace-timeline")).toBeInTheDocument();
    });

    it("renders span names for flat (root-only) spans", () => {
      const spans = makeFlatSpans();
      render(<TraceTimeline spans={spans} />);
      expect(screen.getByText("turn:execute")).toBeInTheDocument();
      expect(screen.getByText("llm:chat")).toBeInTheDocument();
      expect(screen.getByText("tool:run")).toBeInTheDocument();
    });

    it("renders root span names in a tree (collapsed)", () => {
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);
      // Only root is visible when collapsed
      expect(screen.getByText("turn:execute")).toBeInTheDocument();
    });

    it("renders root spans at depth 0 with 0rem padding", () => {
      const spans = [makeSpan({ id: "root", name: "turn:execute" })];
      render(<TraceTimeline spans={spans} />);
      const nameCol = screen.getByTestId("span-name-root");
      expect(nameCol.style.paddingLeft).toBe("0rem");
    });
  });

  describe("indentation", () => {
    it("renders child spans with increased padding after expand", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);

      // Expand root to see children
      await user.click(screen.getByTestId("expand-toggle-root"));

      const rootName = screen.getByTestId("span-name-root");
      const childName = screen.getByTestId("span-name-child-1");

      const rootPadding = parseFloat(rootName.style.paddingLeft);
      const childPadding = parseFloat(childName.style.paddingLeft);
      expect(childPadding).toBeGreaterThan(rootPadding);
    });

    it("renders deeply nested spans with proportional indentation after expand-all", async () => {
      const user = userEvent.setup();
      const spans = makeDeepTrace();
      render(<TraceTimeline spans={spans} />);

      // Expand all to see nested spans
      await user.click(screen.getByTestId("expand-all-root"));

      const root = screen.getByTestId("span-name-root");
      const child = screen.getByTestId("span-name-child-a");
      const grandchild = screen.getByTestId("span-name-grandchild-a1");
      const greatGrandchild = screen.getByTestId("span-name-great-grandchild");

      const rootP = parseFloat(root.style.paddingLeft);
      const childP = parseFloat(child.style.paddingLeft);
      const grandchildP = parseFloat(grandchild.style.paddingLeft);
      const ggP = parseFloat(greatGrandchild.style.paddingLeft);

      // Each level adds 1rem
      expect(childP - rootP).toBeCloseTo(1, 0);
      expect(grandchildP - childP).toBeCloseTo(1, 0);
      expect(ggP - grandchildP).toBeCloseTo(1, 0);
    });
  });

  describe("tree connector lines", () => {
    it("renders tree connector lines for child spans after expand", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);

      // Expand root to see children
      await user.click(screen.getByTestId("expand-toggle-root"));

      const childName = screen.getByTestId("span-name-child-1");
      expect(childName).toHaveAttribute("data-has-connector", "true");
    });

    it("root spans do not have connector lines", () => {
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);

      const rootName = screen.getByTestId("span-name-root");
      expect(rootName).toHaveAttribute("data-has-connector", "false");
    });
  });

  describe("Gantt bar positioning", () => {
    it("positions root span bar at 0% with 100% width", () => {
      const spans = [makeSpan({ id: "root", name: "turn", startTime: 1000, endTime: 3000, duration: 2000 })];
      render(<TraceTimeline spans={spans} />);

      const bar = screen.getByTestId("gantt-bar-root");
      expect(bar).toHaveStyle({ left: "0%", width: "100%" });
    });

    it("positions child Gantt bar relative to root span start time after expand", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);

      // Expand root to see children
      await user.click(screen.getByTestId("expand-toggle-root"));

      // Root: startTime=1000, endTime=3000, overall=2000
      // child-1: startTime=1100, duration=900
      // left = (1100-1000)/2000 = 5%, width = 900/2000 = 45%
      const bar = screen.getByTestId("gantt-bar-child-1");
      expect(bar).toHaveStyle({ left: "5%", width: "45%" });
    });

    it("handles spans with no endTime using duration after expand", async () => {
      const user = userEvent.setup();
      const spans = [
        makeSpan({ id: "root", name: "turn", startTime: 0, endTime: 1000, duration: 1000 }),
        makeSpan({ id: "open", parentSpanId: "root", name: "llm:stream", startTime: 100, endTime: undefined, duration: 400 }),
      ];
      render(<TraceTimeline spans={spans} />);

      // Expand root to see child
      await user.click(screen.getByTestId("expand-toggle-root"));

      const bar = screen.getByTestId("gantt-bar-open");
      // left = 100/1000 = 10%, width = 400/1000 = 40%
      expect(bar).toHaveStyle({ left: "10%", width: "40%" });
    });
  });

  describe("expand/collapse", () => {
    it("collapses children by default when spans have children", () => {
      const spans = makeDeepTrace();
      render(<TraceTimeline spans={spans} />);

      // Only root should be visible initially; children hidden
      expect(screen.getByText("chain:run")).toBeInTheDocument();
      // Children should not be visible when collapsed
      expect(screen.queryByText("turn:1")).not.toBeInTheDocument();
      expect(screen.queryByText("llm:chat")).not.toBeInTheDocument();
    });

    it("expands children when toggle button is clicked", async () => {
      const user = userEvent.setup();
      const spans = makeDeepTrace();
      render(<TraceTimeline spans={spans} />);

      const toggleBtn = screen.getByTestId("expand-toggle-root");
      await user.click(toggleBtn);

      // Direct children should now be visible
      expect(screen.getByText("turn:1")).toBeInTheDocument();
      expect(screen.getByText("turn:2")).toBeInTheDocument();
    });

    it("collapses children when toggle is clicked twice", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);

      // Expand
      const toggleBtn = screen.getByTestId("expand-toggle-root");
      await user.click(toggleBtn);
      expect(screen.getByText("llm:chat")).toBeInTheDocument();

      // Collapse
      await user.click(toggleBtn);
      expect(screen.queryByText("llm:chat")).not.toBeInTheDocument();
    });

    it("expand-all button expands all descendants", async () => {
      const user = userEvent.setup();
      const spans = makeDeepTrace();
      render(<TraceTimeline spans={spans} />);

      const expandAllBtn = screen.getByTestId("expand-all-root");
      await user.click(expandAllBtn);

      // All descendants should be visible
      expect(screen.getByText("turn:1")).toBeInTheDocument();
      expect(screen.getByText("llm:chat")).toBeInTheDocument();
      expect(screen.getByText("tool:search")).toBeInTheDocument();
      expect(screen.getByText("context:load")).toBeInTheDocument();
      expect(screen.getByText("turn:2")).toBeInTheDocument();
      expect(screen.getByText("llm:stream")).toBeInTheDocument();
    });

    it("collapse-all button collapses all descendants", async () => {
      const user = userEvent.setup();
      const spans = makeDeepTrace();
      render(<TraceTimeline spans={spans} />);

      // First expand all
      const expandAllBtn = screen.getByTestId("expand-all-root");
      await user.click(expandAllBtn);
      expect(screen.getByText("llm:chat")).toBeInTheDocument();

      // Then collapse all
      const collapseAllBtn = screen.getByTestId("collapse-all-root");
      await user.click(collapseAllBtn);

      // Only root should remain
      expect(screen.getByText("chain:run")).toBeInTheDocument();
      expect(screen.queryByText("turn:1")).not.toBeInTheDocument();
    });
  });

  describe("search integration", () => {
    it("auto-expands ancestors of matching spans and dims non-matches", () => {
      const spans = makeSimpleTrace();
      // searchQuery="llm" matches "llm:chat" (child-1); root should auto-expand and be dimmed
      render(<TraceTimeline spans={spans} searchQuery="llm" />);

      // "llm:chat" should be visible (auto-expanded) and NOT faded
      const matchRow = screen.getByTestId("span-row-child-1");
      expect(matchRow).not.toHaveClass("opacity-30");

      // Root should be dimmed (doesn't match "llm")
      const nonMatchRow = screen.getByTestId("span-row-root");
      expect(nonMatchRow).toHaveClass("opacity-30");
    });

    it("auto-expands ancestors of deeply nested matching spans", () => {
      const spans = makeDeepTrace();
      render(<TraceTimeline spans={spans} searchQuery="context:load" />);

      // "context:load" is nested under root -> child-a -> grandchild-a2
      // All ancestors should be expanded so the match is visible
      expect(screen.getByText("context:load")).toBeInTheDocument();
      expect(screen.getByText("tool:search")).toBeInTheDocument();
      expect(screen.getByText("turn:1")).toBeInTheDocument();
    });
  });

  describe("type filtering", () => {
    it("dims spans whose type is in fadedTypes after expand", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      // "llm" type should be faded
      render(<TraceTimeline spans={spans} fadedTypes={new Set(["llm"])} />);

      // Expand root to see children
      await user.click(screen.getByTestId("expand-toggle-root"));

      const llmRow = screen.getByTestId("span-row-child-1");
      expect(llmRow).toHaveClass("opacity-30");

      const turnRow = screen.getByTestId("span-row-root");
      expect(turnRow).not.toHaveClass("opacity-30");
    });

    it("faded spans have hover:opacity-60 class", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} fadedTypes={new Set(["llm"])} />);

      // Expand root to see children
      await user.click(screen.getByTestId("expand-toggle-root"));

      const llmRow = screen.getByTestId("span-row-child-1");
      expect(llmRow.className).toContain("hover:opacity-60");
    });
  });

  describe("legend", () => {
    it("shows legend with present span types", () => {
      const spans = makeFlatSpans();
      // turn, llm, tool types present
      render(<TraceTimeline spans={spans} />);

      expect(screen.getByTestId("legend")).toBeInTheDocument();
      expect(screen.getByText("Turn")).toBeInTheDocument();
      expect(screen.getByText("LLM")).toBeInTheDocument();
      expect(screen.getByText("Tool")).toBeInTheDocument();
    });

    it("does not show types that are not present in spans", () => {
      const spans = makeFlatSpans();
      render(<TraceTimeline spans={spans} />);

      // Chain type not present
      expect(screen.queryByText("Chain")).not.toBeInTheDocument();
      expect(screen.queryByText("Agent")).not.toBeInTheDocument();
    });

    it("shows colored dots for each type in legend", () => {
      const spans = makeFlatSpans();
      render(<TraceTimeline spans={spans} />);

      const legend = screen.getByTestId("legend");
      const dots = within(legend).getAllByTestId("legend-dot");
      // Should have one dot per present type (turn, llm, tool = 3)
      expect(dots.length).toBe(3);
    });
  });

  describe("Gantt bar tooltip", () => {
    it("shows latency on hover", async () => {
      const user = userEvent.setup();
      const spans = makeSimpleTrace();
      render(<TraceTimeline spans={spans} />);

      // Expand to see children
      await user.click(screen.getByTestId("expand-toggle-root"));

      const bar = screen.getByTestId("gantt-bar-child-1");
      await user.hover(bar);

      // Tooltip should show latency info
      expect(screen.getByTestId("gantt-tooltip")).toBeInTheDocument();
    });
  });
});
