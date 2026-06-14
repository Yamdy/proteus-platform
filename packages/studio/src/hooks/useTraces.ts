import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";

// --- Types ---

export interface TraceSummary {
  traceId: string;
  sessionId: string;
  entityName?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error" | "unset";
  spanCount: number;
}

export interface ListTracesArgs {
  sessionId?: string;
  entityName?: string;
  status?: string;
  limit?: number;
}

export interface ListTracesResponse {
  traces: TraceSummary[];
  hasMore: boolean;
  page: number;
}

export interface UseTracesReturn {
  traces: TraceSummary[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  recentlyAddedKeys: Set<string>;
  isRefetching: boolean;
}

// --- Constants ---

const PAGE_SIZE = 25;
const DELTA_POLL_MS = 5_000;
const PAGE0_REFRESH_MS = 60_000;
const HIGHLIGHT_DURATION_MS = 1_000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const HEARTBEAT_MIN_MS = 400;
const DELTA_CHASE_MS = 100;

// --- Helpers ---

function buildTracesUrl(
  filters: ListTracesArgs | undefined,
  page: number,
  mode?: "full" | "delta",
  after?: number,
): string {
  const sessionId = filters?.sessionId ?? "default";
  const url = new URL(
    `/api/traces/${sessionId}`,
    window.location.origin,
  );
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(PAGE_SIZE));
  if (filters?.entityName) url.searchParams.set("entityName", filters.entityName);
  if (filters?.status) url.searchParams.set("status", filters.status);
  if (mode) url.searchParams.set("mode", mode);
  if (after !== undefined) url.searchParams.set("after", String(after));
  return url.toString();
}

function fetchTracesPage(
  filters: ListTracesArgs | undefined,
  page: number,
  mode?: "full" | "delta",
  after?: number,
): Promise<ListTracesResponse> {
  const url = buildTracesUrl(filters, page, mode, after);
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Failed to fetch traces: ${res.status}`);
    return res.json();
  });
}

/** Compute the max startTime across all loaded traces (the delta cursor). */
function computeDeltaCursor(traces: TraceSummary[]): number {
  if (traces.length === 0) return 0;
  return Math.max(...traces.map((t) => t.startTime));
}

// --- Hook ---

export function useTraces(filters?: ListTracesArgs): UseTracesReturn {
  const queryClient = useQueryClient();
  const [recentlyAddedKeys, setRecentlyAddedKeys] = useState<Set<string>>(
    new Set(),
  );
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const isFetchingRef = useRef(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHiddenAtRef = useRef<number | null>(null);

  // --- Infinite query ---

  const queryKey = ["traces", filters] as const;

  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
    isFetching,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: number }) => fetchTracesPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: ListTracesResponse) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  // Flatten all pages into a single traces array
  const traces: TraceSummary[] = data
    ? data.pages.flatMap((p: ListTracesResponse) => p.traces)
    : [];

  // --- Visual heartbeat: isRefetching pulses for at least HEARTBEAT_MIN_MS ---

  useEffect(() => {
    if (isFetching) {
      if (!isFetchingRef.current) {
        isFetchingRef.current = true;
        setIsRefetching(true);
        // Clear any pending down-timer
        if (heartbeatTimerRef.current) {
          clearTimeout(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
      }
    } else {
      if (isFetchingRef.current) {
        isFetchingRef.current = false;
        // Keep isRefetching true for at least HEARTBEAT_MIN_MS
        heartbeatTimerRef.current = setTimeout(() => {
          setIsRefetching(false);
          heartbeatTimerRef.current = null;
        }, HEARTBEAT_MIN_MS);
      }
    }
    return () => {
      if (heartbeatTimerRef.current) {
        clearTimeout(heartbeatTimerRef.current);
      }
    };
  }, [isFetching]);

  // --- Highlight helper: add a key, auto-remove after HIGHLIGHT_DURATION_MS ---

  const addHighlight = useCallback((traceId: string) => {
    setRecentlyAddedKeys((prev) => {
      const next = new Set(prev);
      next.add(traceId);
      return next;
    });
    // Clear any existing timer for this key
    const existing = highlightTimersRef.current.get(traceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setRecentlyAddedKeys((prev) => {
        const next = new Set(prev);
        next.delete(traceId);
        return next;
      });
      highlightTimersRef.current.delete(traceId);
    }, HIGHLIGHT_DURATION_MS);
    highlightTimersRef.current.set(traceId, timer);
  }, []);

  // --- Delta polling every DELTA_POLL_MS ---

  const deltaPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deltaChasingRef = useRef(false);

  const runDeltaPoll = useCallback(async () => {
    if (deltaChasingRef.current) return; // already chasing

    const allTraces = queryClient.getQueryData<
      import("@tanstack/react-query").InfiniteData<ListTracesResponse, number>
    >(queryKey);

    const flatTraces = allTraces
      ? allTraces.pages.flatMap((p: ListTracesResponse) => p.traces)
      : [];
    const cursor = computeDeltaCursor(flatTraces);

    try {
      const deltaPage = await fetchTracesPage(
        filters,
        0,
        "delta",
        cursor > 0 ? cursor : undefined,
      );

      if (deltaPage.traces.length > 0) {
        // Append delta results to the first page
        queryClient.setQueryData(
          queryKey,
          (
            old:
              | import("@tanstack/react-query").InfiniteData<
                  ListTracesResponse,
                  number
                >
              | undefined,
          ) => {
            if (!old) return old;
            const pages = [...old.pages];
            // Prepend new traces to page 0 (they're newest)
            pages[0] = {
              ...pages[0],
              traces: [...deltaPage.traces, ...pages[0].traces],
            };
            return { ...old, pages };
          },
        );

        // Highlight the new trace IDs
        for (const t of deltaPage.traces) {
          addHighlight(t.traceId);
        }
      }

      // Chase: if delta response says hasMore, keep fetching at DELTA_CHASE_MS
      if (deltaPage.hasMore) {
        deltaChasingRef.current = true;
        const chaseInterval = setInterval(async () => {
          const currentData = queryClient.getQueryData<
            import("@tanstack/react-query").InfiniteData<
              ListTracesResponse,
              number
            >
          >(queryKey);
          const currentTraces = currentData
            ? currentData.pages.flatMap((p: ListTracesResponse) => p.traces)
            : [];
          const chaseCursor = computeDeltaCursor(currentTraces);

          try {
            const chasePage = await fetchTracesPage(
              filters,
              0,
              "delta",
              chaseCursor > 0 ? chaseCursor : undefined,
            );

            if (chasePage.traces.length > 0) {
              queryClient.setQueryData(
                queryKey,
                (
                  old:
                    | import("@tanstack/react-query").InfiniteData<
                        ListTracesResponse,
                        number
                      >
                    | undefined,
                ) => {
                  if (!old) return old;
                  const pages = [...old.pages];
                  pages[0] = {
                    ...pages[0],
                    traces: [...chasePage.traces, ...pages[0].traces],
                  };
                  return { ...old, pages };
                },
              );
              for (const t of chasePage.traces) {
                addHighlight(t.traceId);
              }
            }

            if (!chasePage.hasMore) {
              clearInterval(chaseInterval);
              deltaChasingRef.current = false;
            }
          } catch {
            clearInterval(chaseInterval);
            deltaChasingRef.current = false;
          }
        }, DELTA_CHASE_MS);
      }
    } catch {
      // Delta poll failed silently — will retry on next interval
    }
  }, [queryClient, queryKey, filters, addHighlight]);

  // Set up the delta poll interval
  useEffect(() => {
    deltaPollRef.current = setInterval(runDeltaPoll, DELTA_POLL_MS);
    return () => {
      if (deltaPollRef.current) {
        clearInterval(deltaPollRef.current);
      }
    };
  }, [runDeltaPoll]);

  // --- Page-0 status refresh every PAGE0_REFRESH_MS ---

  const page0RefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    page0RefreshRef.current = setInterval(() => {
      // Refetch page 0 to surface status flips (running -> success/error)
      refetch({ throwOnError: false });
    }, PAGE0_REFRESH_MS);

    return () => {
      if (page0RefreshRef.current) {
        clearInterval(page0RefreshRef.current);
      }
    };
  }, [refetch]);

  // --- Idle guard: reset query when tab returns from hidden after 15+ min ---

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        lastHiddenAtRef.current = Date.now();
      } else if (document.visibilityState === "visible") {
        if (lastHiddenAtRef.current !== null) {
          const hiddenDuration = Date.now() - lastHiddenAtRef.current;
          lastHiddenAtRef.current = null;
          if (hiddenDuration >= IDLE_THRESHOLD_MS) {
            // Reset the infinite query to re-seed the cursor
            queryClient.resetQueries({ queryKey });
          }
        }
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryClient, queryKey]);

  // --- Cleanup highlight timers on unmount ---

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // --- Expose fetchNextPage as a stable callback ---

  const stableFetchNextPage = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  return {
    traces,
    isLoading,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage: stableFetchNextPage,
    recentlyAddedKeys,
    isRefetching,
  };
}
