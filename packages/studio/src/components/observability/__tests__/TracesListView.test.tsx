import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TracesListView from "../TracesListView";
import type { Trace } from "../../../hooks/useObservability";

// --- Mocks ---

// Mock IntersectionObserver for infinite scroll sentinel
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IntersectionObserver = class MockIntersectionObserver {
    observe = mockObserve;
    unobserve = mockUnobserve;
    disconnect = mockDisconnect;
    root = null;
    rootMargin = "";
    thresholds = [];
    takeRecords = vi.fn().mockReturnValue([]);
    constructor(_callback: IntersectionObserverCallback) {}
  } as unknown as typeof IntersectionObserver;

  // Mock ResizeObserver for virtual list
  globalThis.ResizeObserver = class MockResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(_callback: ResizeObserverCallback) {}
  } as unknown as typeof ResizeObserver;
});

// --- Helpers ---

function makeTrace(overrides: Partial<Trace> & { entityName?: string; input?: unknown } = {}): Trace & { entityName?: string; input?: unknown } {
  return {
    traceId: `trace-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess-001",
    startTime: new Date("2026-01-15T10:30:00Z").getTime(),
    status: "ok" as const,
    spans: [
      {
        id: "span-1",
        traceId: overrides.traceId ?? "trace-1",
        name: "llm.inference",
        startTime: new Date("2026-01-15T10:30:00Z").getTime(),
        endTime: new Date("2026-01-15T10:30:01Z").getTime(),
        duration: 1000,
        status: "ok" as const,
      },
    ],
    ...overrides,
  };
}

function renderWithRouter(
  ui: React.ReactElement,
  initialEntries: string[] = ["/observability"],
) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>,
  );
}

// --- Tests ---

describe("TracesListView", () => {
  const defaultProps = {
    traces: [] as ReturnType<typeof makeTrace>[],
    selectedTraceId: null as string | null,
    onSelectTrace: vi.fn(),
    recentlyAddedKeys: new Set<string>(),
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
  };

  it("renders with grid layout container", () => {
    renderWithRouter(<TracesListView {...defaultProps} />);
    const list = screen.getByTestId("traces-list");
    expect(list).toBeInTheDocument();
  });

  it("renders column headers", () => {
    renderWithRouter(<TracesListView {...defaultProps} />);
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Entity")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders traces with grid row layout", () => {
    const traces = [
      makeTrace({
        traceId: "t1",
        entityName: "ChatAgent",
        input: "Hello world",
      }),
    ];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    expect(screen.getByText("ChatAgent")).toBeInTheDocument();
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("displays locale date string from startTime", () => {
    const ts = new Date("2026-01-15T14:30:00Z").getTime();
    const traces = [makeTrace({ traceId: "t1", startTime: ts })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    // Date column should contain a locale date string
    const dateCell = screen.getByTestId("trace-date-t1");
    expect(dateCell.textContent).toBeTruthy();
    expect(dateCell.textContent!.length).toBeGreaterThan(0);
  });

  it("displays locale time string from startTime", () => {
    const ts = new Date("2026-01-15T14:30:00Z").getTime();
    const traces = [makeTrace({ traceId: "t1", startTime: ts })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const timeCell = screen.getByTestId("trace-time-t1");
    expect(timeCell.textContent).toBeTruthy();
  });

  it("shows colored type dot in Name column", () => {
    const traces = [makeTrace({ traceId: "t1" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const dot = screen.getByTestId("trace-type-dot-t1");
    expect(dot).toBeInTheDocument();
    // Should have a background color class
    expect(dot.className).toMatch(/bg-/);
  });

  it("shows span name in Name column", () => {
    const traces = [makeTrace({ traceId: "t1" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    expect(screen.getByText("llm.inference")).toBeInTheDocument();
  });

  it("shows truncated input preview", () => {
    const longInput = "x".repeat(120);
    const traces = [makeTrace({ traceId: "t1", input: longInput })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const inputCell = screen.getByTestId("trace-input-t1");
    expect(inputCell.textContent!.length).toBeLessThanOrEqual(80);
    expect(inputCell.textContent).toBe("x".repeat(80));
  });

  it("shows entity name", () => {
    const traces = [makeTrace({ traceId: "t1", entityName: "MyAgent" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    expect(screen.getByText("MyAgent")).toBeInTheDocument();
  });

  it("renders green status badge for ok", () => {
    const traces = [makeTrace({ traceId: "t1", status: "ok" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const badge = screen.getByTestId("trace-status-t1");
    expect(badge.className).toMatch(/emerald|green/);
    expect(badge).toHaveTextContent("ok");
  });

  it("renders red status badge for error", () => {
    const traces = [makeTrace({ traceId: "t1", status: "error" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const badge = screen.getByTestId("trace-status-t1");
    expect(badge.className).toMatch(/red/);
    expect(badge).toHaveTextContent("error");
  });

  it("renders yellow status badge for unset/running", () => {
    const traces = [makeTrace({ traceId: "t1", status: "unset" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const badge = screen.getByTestId("trace-status-t1");
    expect(badge.className).toMatch(/yellow|amber/);
    expect(badge).toHaveTextContent("running");
  });

  it("calls onSelectTrace when row is clicked", () => {
    const onSelect = vi.fn();
    const traces = [makeTrace({ traceId: "t-abc" })];
    renderWithRouter(
      <TracesListView {...defaultProps} traces={traces} onSelectTrace={onSelect} />,
    );
    const row = screen.getByTestId("trace-row-t-abc");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("t-abc");
  });

  it("highlights selected row", () => {
    const traces = [makeTrace({ traceId: "t1" })];
    renderWithRouter(
      <TracesListView {...defaultProps} traces={traces} selectedTraceId="t1" />,
    );
    const row = screen.getByTestId("trace-row-t1");
    expect(row.className).toMatch(/cyan/);
  });

  it("renders infinite scroll sentinel element", () => {
    renderWithRouter(<TracesListView {...defaultProps} hasNextPage />);
    const sentinel = screen.getByTestId("scroll-sentinel");
    expect(sentinel).toBeInTheDocument();
  });

  it("applies animate-row-highlight to recently added rows", () => {
    const traces = [makeTrace({ traceId: "t-new" })];
    const recentlyAddedKeys = new Set(["t-new"]);
    renderWithRouter(
      <TracesListView
        {...defaultProps}
        traces={traces}
        recentlyAddedKeys={recentlyAddedKeys}
      />,
    );
    const row = screen.getByTestId("trace-row-t-new");
    expect(row.className).toMatch(/animate-row-highlight/);
  });

  it("does not apply highlight to non-recent rows", () => {
    const traces = [makeTrace({ traceId: "t-old" })];
    renderWithRouter(<TracesListView {...defaultProps} traces={traces} />);
    const row = screen.getByTestId("trace-row-t-old");
    expect(row.className).not.toMatch(/animate-row-highlight/);
  });

  it("shows empty state when no traces", () => {
    renderWithRouter(<TracesListView {...defaultProps} traces={[]} />);
    expect(screen.getByText(/no traces/i)).toBeInTheDocument();
  });

  it("shows loading indicator when fetching next page", () => {
    renderWithRouter(
      <TracesListView {...defaultProps} isFetchingNextPage hasNextPage />,
    );
    expect(screen.getByTestId("loading-more")).toBeInTheDocument();
  });
});
