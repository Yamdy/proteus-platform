import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { MetricsProvider, useMetricsFilters } from "../useMetricsFilters";

// Helper to wrap hook in both Router and MetricsProvider
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/observability"]}>
      <MetricsProvider>{children}</MetricsProvider>
    </MemoryRouter>
  );
}

function wrapperWithInitialUrl(initialUrl: string) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <MemoryRouter initialEntries={[initialUrl]}>
        <MetricsProvider>{children}</MetricsProvider>
      </MemoryRouter>
    );
  };
}

describe("useMetricsFilters", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns default preset of '7d'", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    expect(result.current.preset).toBe("7d");
  });

  it("returns correct time window for 7d preset", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    const now = Date.now();
    expect(result.current.filters.timestamp.end).toBe(now);
    expect(result.current.filters.timestamp.start).toBe(now - 604_800_000);
  });

  it("setPreset updates preset and recomputes window", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    act(() => {
      result.current.setPreset("24h");
    });
    expect(result.current.preset).toBe("24h");
    const now = Date.now();
    expect(result.current.filters.timestamp.start).toBe(now - 86_400_000);
  });

  it("setCustomRange sets preset to 'custom' and uses provided range", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    act(() => {
      result.current.setCustomRange(1000, 2000);
    });
    expect(result.current.preset).toBe("custom");
    expect(result.current.filters.timestamp).toEqual({ start: 1000, end: 2000 });
  });

  it("setFilterTokens updates dimensional filter", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    act(() => {
      result.current.setFilterTokens({ entityType: "tool", tags: ["prod"] });
    });
    expect(result.current.filters.dimensionalFilter).toEqual({
      entityType: "tool",
      tags: ["prod"],
    });
  });

  it("filterKey changes when preset changes", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    const key1 = result.current.filterKey;
    act(() => {
      result.current.setPreset("24h");
    });
    expect(result.current.filterKey).not.toBe(key1);
  });

  it("filterKey is stable when nothing changes", () => {
    const { result } = renderHook(() => useMetricsFilters(), { wrapper });
    const key1 = result.current.filterKey;
    const key2 = result.current.filterKey;
    expect(key1).toBe(key2);
  });

  it("reads preset from URL params", () => {
    const w = wrapperWithInitialUrl("/observability?preset=3d");
    const { result } = renderHook(() => useMetricsFilters(), { wrapper: w });
    expect(result.current.preset).toBe("3d");
  });

  it("reads filter tokens from URL params", () => {
    const w = wrapperWithInitialUrl(
      "/observability?entityType=tool&sessionId=sess-1",
    );
    const { result } = renderHook(() => useMetricsFilters(), { wrapper: w });
    expect(result.current.filters.dimensionalFilter).toEqual({
      entityType: "tool",
      sessionId: "sess-1",
    });
  });
});

describe("MetricsProvider", () => {
  it("throws when useMetricsFilters is used outside provider", () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useMetricsFilters(), {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <MemoryRouter>{children}</MemoryRouter>
        ),
      });
    }).toThrow(/MetricsProvider/);
    spy.mockRestore();
  });
});
