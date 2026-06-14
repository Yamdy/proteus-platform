import { useMemo, useCallback } from "react";

export interface UISpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  type?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error" | "unset";
  input?: unknown;
  output?: unknown;
  attributes?: Record<string, unknown>;
  tags?: string[];
  runId?: string;
  sessionId?: string;
  tokens?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  children?: UISpan[];
}

/**
 * Recursively flattens a UISpan tree into an ordered list of IDs (depth-first).
 */
export function flattenDepthFirst(roots: UISpan[]): string[] {
  const ids: string[] = [];
  for (const span of roots) {
    ids.push(span.id);
    if (span.children?.length) {
      ids.push(...flattenDepthFirst(span.children));
    }
  }
  return ids;
}

export interface UseTraceSpanNavigationReturn {
  flatIds: string[];
  currentIndex: number;
  handlePreviousSpan: () => string | null;
  handleNextSpan: () => string | null;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Provides depth-first span navigation over a tree of UISpans.
 */
export function useTraceSpanNavigation(
  roots: UISpan[],
  selectedSpanId: string | null,
): UseTraceSpanNavigationReturn {
  const flatIds = useMemo(() => flattenDepthFirst(roots), [roots]);
  const currentIndex = selectedSpanId != null ? flatIds.indexOf(selectedSpanId) : -1;

  const handlePreviousSpan = useCallback(
    () => (currentIndex > 0 ? flatIds[currentIndex - 1] : null),
    [flatIds, currentIndex],
  );

  const handleNextSpan = useCallback(
    () => (currentIndex >= 0 && currentIndex < flatIds.length - 1 ? flatIds[currentIndex + 1] : null),
    [flatIds, currentIndex],
  );

  return {
    flatIds,
    currentIndex,
    handlePreviousSpan,
    handleNextSpan,
    hasPrevious: currentIndex > 0,
    hasNext: currentIndex >= 0 && currentIndex < flatIds.length - 1,
  };
}
