import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SpanDetailPanel } from "../SpanDetailPanel";
import type { UISpan } from "../SpanDetailPanel";
import { useTraceSpanNavigation, flattenDepthFirst } from "../../../hooks/useTraceSpanNavigation";

// --- Test fixtures ---

function makeSpan(overrides: Partial<UISpan> = {}): UISpan {
  return {
    id: "span-001",
    traceId: "trace-abc",
    name: "LLM Inference",
    type: "llm",
    startTime: 1700000000000,
    endTime: 1700000001500,
    duration: 1500,
    status: "ok",
    input: { prompt: "Hello" },
    output: { text: "Hi there" },
    attributes: { model: "gpt-4", temperature: 0.7 },
    tags: ["production", "v2"],
    runId: "run-42",
    sessionId: "sess-99",
    tokens: {
      input: 100,
      output: 50,
      cacheRead: 20,
      cacheWrite: 10,
    },
    ...overrides,
  };
}

function makeSpanTree(): UISpan[] {
  return [
    {
      id: "root-1",
      traceId: "trace-abc",
      name: "Root Span",
      type: "chain",
      startTime: 1700000000000,
      endTime: 1700000005000,
      duration: 5000,
      status: "ok",
      children: [
        {
          id: "child-1a",
          traceId: "trace-abc",
          parentSpanId: "root-1",
          name: "LLM Call",
          type: "llm",
          startTime: 1700000001000,
          endTime: 1700000003000,
          duration: 2000,
          status: "ok",
          tokens: { input: 200, output: 100 },
        },
        {
          id: "child-1b",
          traceId: "trace-abc",
          parentSpanId: "root-1",
          name: "Tool Call",
          type: "tool",
          startTime: 1700000003000,
          endTime: 1700000005000,
          duration: 2000,
          status: "ok",
          children: [
            {
              id: "grandchild-1b1",
              traceId: "trace-abc",
              parentSpanId: "child-1b",
              name: "Sub-tool",
              type: "tool",
              startTime: 1700000003500,
              endTime: 1700000004500,
              duration: 1000,
              status: "ok",
            },
          ],
        },
      ],
    },
    {
      id: "root-2",
      traceId: "trace-abc",
      name: "Second Root",
      type: "retrieval",
      startTime: 1700000006000,
      endTime: 1700000008000,
      duration: 2000,
      status: "error",
    },
  ];
}

// --- Tests ---

describe("SpanDetailPanel", () => {
  describe("renders span header", () => {
    it("displays the span ID in monospace", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("span-id")).toHaveTextContent("span-001");
      expect(screen.getByTestId("span-id")).toHaveClass("font-mono");
    });

    it("displays span type badge with label", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      const badge = screen.getByTestId("span-type-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent("LLM");
    });

    it("displays span name", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("span-name")).toHaveTextContent("LLM Inference");
    });
  });

  describe("renders timing info", () => {
    it("displays start time formatted as locale string", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("span-start-time")).toBeInTheDocument();
    });

    it("displays end time", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("span-end-time")).toBeInTheDocument();
    });

    it("displays duration", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("span-duration")).toHaveTextContent("1.5s");
    });

    it("shows fallback when duration is missing", () => {
      render(<SpanDetailPanel span={makeSpan({ duration: undefined })} />);
      expect(screen.getByTestId("span-duration")).toHaveTextContent("--");
    });
  });

  describe("token usage visualization", () => {
    it("renders token usage bar when tokens are present", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("token-usage-bar")).toBeInTheDocument();
    });

    it("renders input and output segments with correct proportions", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      const inputBar = screen.getByTestId("token-bar-input");
      const outputBar = screen.getByTestId("token-bar-output");
      // input=100, output=50 => total=150, input=66.7%, output=33.3%
      expect(inputBar).toBeInTheDocument();
      expect(outputBar).toBeInTheDocument();
    });

    it("displays token breakdown text", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("token-breakdown")).toBeInTheDocument();
      expect(screen.getByTestId("token-breakdown")).toHaveTextContent("100");
      expect(screen.getByTestId("token-breakdown")).toHaveTextContent("50");
    });

    it("displays cache read and cache write tokens", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("token-cache-read")).toHaveTextContent("20");
      expect(screen.getByTestId("token-cache-write")).toHaveTextContent("10");
    });

    it("does not render token bar when tokens are absent", () => {
      render(<SpanDetailPanel span={makeSpan({ tokens: undefined })} />);
      expect(screen.queryByTestId("token-usage-bar")).not.toBeInTheDocument();
    });
  });

  describe("metadata key-value pairs", () => {
    it("renders traceId", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("meta-traceId")).toHaveTextContent("trace-abc");
    });

    it("renders tags", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("meta-tags")).toHaveTextContent("production");
      expect(screen.getByTestId("meta-tags")).toHaveTextContent("v2");
    });

    it("renders runId", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("meta-runId")).toHaveTextContent("run-42");
    });

    it("renders sessionId", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("meta-sessionId")).toHaveTextContent("sess-99");
    });

    it("renders status", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("meta-status")).toHaveTextContent("ok");
    });
  });

  describe("code sections", () => {
    it("renders input JSON section (expandable)", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      const section = screen.getByTestId("code-section-input");
      expect(section).toBeInTheDocument();
      // Click to expand
      fireEvent.click(within(section).getByText("Input"));
      expect(section).toHaveTextContent("Hello");
    });

    it("renders output JSON section (expandable)", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      const section = screen.getByTestId("code-section-output");
      expect(section).toBeInTheDocument();
      fireEvent.click(within(section).getByText("Output"));
      expect(section).toHaveTextContent("Hi there");
    });

    it("renders attributes JSON section (expandable)", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      const section = screen.getByTestId("code-section-attributes");
      expect(section).toBeInTheDocument();
      fireEvent.click(within(section).getByText("Attributes"));
      expect(section).toHaveTextContent("gpt-4");
    });

    it("shows 'No input' fallback when input is missing", () => {
      render(<SpanDetailPanel span={makeSpan({ input: undefined })} />);
      const section = screen.getByTestId("code-section-input");
      fireEvent.click(within(section).getByText("Input"));
      expect(section).toHaveTextContent("No input");
    });

    it("shows 'No output' fallback when output is missing", () => {
      render(<SpanDetailPanel span={makeSpan({ output: undefined })} />);
      const section = screen.getByTestId("code-section-output");
      fireEvent.click(within(section).getByText("Output"));
      expect(section).toHaveTextContent("No output");
    });
  });

  describe("tabbed interface", () => {
    it("renders Details tab as active by default", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("tab-details")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tab-scoring")).toHaveAttribute("aria-selected", "false");
    });

    it("switches to Scoring tab on click", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      fireEvent.click(screen.getByTestId("tab-scoring"));
      expect(screen.getByTestId("tab-scoring")).toHaveAttribute("aria-selected", "true");
      expect(screen.getByTestId("tab-details")).toHaveAttribute("aria-selected", "false");
    });

    it("shows details content when Details tab is active", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      expect(screen.getByTestId("details-content")).toBeInTheDocument();
    });

    it("shows scoring placeholder when Scoring tab is active", () => {
      render(<SpanDetailPanel span={makeSpan()} />);
      fireEvent.click(screen.getByTestId("tab-scoring"));
      expect(screen.getByTestId("scoring-content")).toBeInTheDocument();
      expect(screen.getByTestId("scoring-content")).toHaveTextContent("Scoring");
    });
  });

  describe("navigation", () => {
    it("calls onNavigatePrev when prev button clicked", () => {
      const onNavigatePrev = vi.fn();
      render(
        <SpanDetailPanel
          span={makeSpan()}
          onNavigatePrev={onNavigatePrev}
          hasPrevious={true}
        />,
      );
      fireEvent.click(screen.getByTestId("nav-prev"));
      expect(onNavigatePrev).toHaveBeenCalledTimes(1);
    });

    it("calls onNavigateNext when next button clicked", () => {
      const onNavigateNext = vi.fn();
      render(
        <SpanDetailPanel
          span={makeSpan()}
          onNavigateNext={onNavigateNext}
          hasNext={true}
        />,
      );
      fireEvent.click(screen.getByTestId("nav-next"));
      expect(onNavigateNext).toHaveBeenCalledTimes(1);
    });

    it("disables prev button when hasPrevious is false", () => {
      render(<SpanDetailPanel span={makeSpan()} hasPrevious={false} />);
      expect(screen.getByTestId("nav-prev")).toBeDisabled();
    });

    it("disables next button when hasNext is false", () => {
      render(<SpanDetailPanel span={makeSpan()} hasNext={false} />);
      expect(screen.getByTestId("nav-next")).toBeDisabled();
    });
  });

  describe("empty span fallbacks", () => {
    it("renders gracefully with minimal span", () => {
      const minimal: UISpan = {
        id: "min-span",
        traceId: "trace-min",
        name: "Minimal",
        type: "unknown",
        startTime: Date.now(),
        status: "unset",
      };
      render(<SpanDetailPanel span={minimal} />);
      expect(screen.getByTestId("span-id")).toHaveTextContent("min-span");
      expect(screen.getByTestId("span-duration")).toHaveTextContent("--");
      expect(screen.queryByTestId("token-usage-bar")).not.toBeInTheDocument();
    });

    it("renders error status correctly", () => {
      render(<SpanDetailPanel span={makeSpan({ status: "error" })} />);
      expect(screen.getByTestId("meta-status")).toHaveTextContent("error");
    });
  });
});

describe("useTraceSpanNavigation", () => {
  describe("flattenDepthFirst", () => {
    it("flattens a tree in depth-first order", () => {
      const roots = makeSpanTree();
      const ids = flattenDepthFirst(roots);
      expect(ids).toEqual([
        "root-1",
        "child-1a",
        "child-1b",
        "grandchild-1b1",
        "root-2",
      ]);
    });

    it("returns empty array for empty roots", () => {
      expect(flattenDepthFirst([])).toEqual([]);
    });

    it("handles spans without children", () => {
      const flat: UISpan[] = [makeSpan({ id: "a" }), makeSpan({ id: "b" })];
      expect(flattenDepthFirst(flat)).toEqual(["a", "b"]);
    });
  });

  // useTraceSpanNavigation is tested via a wrapper component
  function NavigationTestHarness({
    roots,
    selectedSpanId,
  }: {
    roots: UISpan[];
    selectedSpanId: string | null;
  }) {
    const nav = useTraceSpanNavigation(roots, selectedSpanId);
    return (
      <div>
        <span data-testid="flat-ids">{nav.flatIds.join(",")}</span>
        <span data-testid="current-index">{nav.currentIndex}</span>
        <span data-testid="has-previous">{String(nav.hasPrevious)}</span>
        <span data-testid="has-next">{String(nav.hasNext)}</span>
        <button data-testid="prev-btn" onClick={() => {}}>
          {nav.handlePreviousSpan()}
        </button>
        <button data-testid="next-btn" onClick={() => {}}>
          {nav.handleNextSpan()}
        </button>
      </div>
    );
  }

  it("returns correct index for selected span", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="child-1a" />);
    expect(screen.getByTestId("current-index")).toHaveTextContent("1");
  });

  it("reports hasPrevious=true when not at start", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="child-1a" />);
    expect(screen.getByTestId("has-previous")).toHaveTextContent("true");
  });

  it("reports hasPrevious=false at first element", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="root-1" />);
    expect(screen.getByTestId("has-previous")).toHaveTextContent("false");
  });

  it("reports hasNext=true when not at end", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="child-1a" />);
    expect(screen.getByTestId("has-next")).toHaveTextContent("true");
  });

  it("reports hasNext=false at last element", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="root-2" />);
    expect(screen.getByTestId("has-next")).toHaveTextContent("false");
  });

  it("returns correct previous span id", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="child-1b" />);
    expect(screen.getByTestId("prev-btn")).toHaveTextContent("child-1a");
  });

  it("returns correct next span id", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="child-1a" />);
    expect(screen.getByTestId("next-btn")).toHaveTextContent("child-1b");
  });

  it("returns -1 for currentIndex when span not found", () => {
    render(<NavigationTestHarness roots={makeSpanTree()} selectedSpanId="nonexistent" />);
    expect(screen.getByTestId("current-index")).toHaveTextContent("-1");
  });
});
