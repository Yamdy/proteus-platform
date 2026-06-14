import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTraces } from "../useTraces.js";

// --- Test helpers ---

function makeTrace(
  overrides: Partial<{
    traceId: string;
    startTime: number;
    entityName: string;
    status: string;
  }> = {},
) {
  return {
    traceId:
      overrides.traceId ?? `trace-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: "sess-1",
    entityName: overrides.entityName ?? "agent-1",
    startTime: overrides.startTime ?? Date.now(),
    endTime: undefined,
    duration: undefined,
    status: (overrides.status as "ok" | "error" | "unset") ?? "ok",
    spanCount: 1,
  };
}

function makePage(
  traces: ReturnType<typeof makeTrace>[],
  page: number,
  hasMore: boolean,
) {
  return { traces, hasMore, page };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// --- Tests ---

describe("useTraces", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // shouldAdvanceTime: true lets React Query + waitFor internal timers fire
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    // Stub document.visibilityState
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---- Test 1: Initial fetch loads first page ----
  it("loads the first page on mount", async () => {
    const traces = [
      makeTrace({ traceId: "t1" }),
      makeTrace({ traceId: "t2" }),
    ];
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makePage(traces, 0, true),
    });

    const { result } = renderHook(() => useTraces(), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.traces).toEqual([]);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.traces).toHaveLength(2);
    expect(result.current.traces[0].traceId).toBe("t1");
    expect(result.current.hasNextPage).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("page=0");
  });

  // ---- Test 2: fetchNextPage loads more data ----
  it("fetchNextPage appends the next page of traces", async () => {
    const page0Traces = [makeTrace({ traceId: "t1" })];
    const page1Traces = [makeTrace({ traceId: "t2" })];

    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page0Traces, 0, true),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makePage(page1Traces, 1, false),
      });

    const { result } = renderHook(() => useTraces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.traces).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.traces).toHaveLength(2);
    });

    expect(result.current.traces[0].traceId).toBe("t1");
    expect(result.current.traces[1].traceId).toBe("t2");
    expect(result.current.hasNextPage).toBe(false);
  });

  // ---- Test 3: Delta polling adds new traces ----
  it("delta polling adds new traces to the list", async () => {
    const initialTraces = [makeTrace({ traceId: "t1", startTime: 1000 })];

    // Initial fetch
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makePage(initialTraces, 0, false),
    });

    const { result } = renderHook(() => useTraces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.traces).toHaveLength(1);

    // Delta poll response with a new trace
    const newTrace = makeTrace({ traceId: "t-new", startTime: 2000 });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makePage([newTrace], 0, false),
    });

    // Advance timer past the 5s delta poll interval
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(result.current.traces).toHaveLength(2);
    });

    expect(
      result.current.traces.find((t: { traceId: string }) => t.traceId === "t-new"),
    ).toBeDefined();
  });

  // ---- Test 4: recentlyAddedKeys populated and cleared after 1s ----
  it("recentlyAddedKeys contains new trace IDs and clears after 1s", async () => {
    const initialTraces = [makeTrace({ traceId: "t1", startTime: 1000 })];

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makePage(initialTraces, 0, false),
    });

    const { result } = renderHook(() => useTraces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Delta poll with new trace
    const newTrace = makeTrace({ traceId: "t-delta", startTime: 2000 });
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makePage([newTrace], 0, false),
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(result.current.recentlyAddedKeys.size).toBeGreaterThan(0);
    });

    expect(result.current.recentlyAddedKeys.has("t-delta")).toBe(true);

    // After 1s the key should be removed
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.recentlyAddedKeys.has("t-delta")).toBe(false);
    expect(result.current.recentlyAddedKeys.size).toBe(0);
  });

  // ---- Test 5: Idle guard resets query after 15min hidden ----
  it("resets infinite query when tab returns from hidden after 15+ minutes", async () => {
    const initialTraces = [makeTrace({ traceId: "t1" })];
    const freshTraces = [makeTrace({ traceId: "t-fresh" })];
    let useFreshTraces = false;

    // Use mockImplementation so delta polls and page-0 refreshes get empty responses
    fetchSpy.mockImplementation(async () => {
      if (useFreshTraces) {
        return {
          ok: true,
          json: async () => makePage(freshTraces, 0, false),
        };
      }
      return {
        ok: true,
        json: async () => makePage(initialTraces, 0, false),
      };
    });

    const { result } = renderHook(() => useTraces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.traces).toHaveLength(1);

    // Simulate tab going hidden
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });

    // Switch to fresh traces before advancing time
    useFreshTraces = true;

    // Advance 16 minutes
    await act(async () => {
      vi.advanceTimersByTime(16 * 60 * 1000);
    });

    // Simulate tab coming back visible — the hook should detect
    // the 15+ minute gap and reset the query
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => {
      // After reset, the fresh traces should appear (old pages cleared)
      expect(
        result.current.traces.some((t: { traceId: string }) => t.traceId === "t-fresh"),
      ).toBe(true);
    });
  });

  // ---- Test 6: passes filters to fetch ----
  it("passes filters as query parameters", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => makePage([], 0, false),
    });

    renderHook(() => useTraces({ entityName: "my-agent" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("entityName=my-agent");
  });

  // ---- Test 7: isRefetching reflects refetch state ----
  it("isRefetching reflects refetch state", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () =>
        makePage([makeTrace({ traceId: "t1" })], 0, false),
    });

    const { result } = renderHook(() => useTraces(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // isRefetching stays true for 400ms heartbeat minimum after fetch ends
    // Advance past the heartbeat timer
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.isRefetching).toBe(false);
  });
});
