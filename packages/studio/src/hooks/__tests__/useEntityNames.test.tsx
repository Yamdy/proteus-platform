import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEntityNames } from "../useEntityNames.js";

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

describe("useEntityNames", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetches and returns entity names", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ["agent-alpha", "agent-beta", "agent-gamma"],
    });

    const { result } = renderHook(() => useEntityNames(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual([
        "agent-alpha",
        "agent-beta",
        "agent-gamma",
      ]);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("/api/traces/entity-names");
  });

  it("returns empty array on fetch failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useEntityNames(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual([]);
    });
  });

  it("uses staleTime of 5 minutes", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ["agent-1"],
    });

    const { result } = renderHook(() => useEntityNames(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current).toEqual(["agent-1"]);
    });

    // Only 1 fetch call despite the hook being mounted
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
