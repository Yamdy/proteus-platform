import { useCallback, useEffect, useRef, useState } from "react";
import type { Trace } from "../../hooks/useObservability";
import { getInputPreview } from "../../lib/get-input-preview";
import { getSpanTypeUi } from "../../lib/get-span-type-ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended trace with optional fields added by the observability pipeline. */
export interface TraceRow extends Trace {
  entityName?: string;
  input?: unknown;
}

export interface TracesListViewProps {
  traces: TraceRow[];
  selectedTraceId: string | null;
  onSelectTrace: (traceId: string) => void;
  recentlyAddedKeys?: Set<string>;
  hasNextPage?: boolean;
  fetchNextPage?: () => void;
  isFetchingNextPage?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 36;
const OVERSCAN = 8;

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  ok: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  error: "bg-red-500/10 text-red-400 border-red-500/20",
  unset: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function statusLabel(status: string): string {
  if (status === "unset") return "running";
  return status;
}

// ---------------------------------------------------------------------------
// Date / time formatting
// ---------------------------------------------------------------------------

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString();
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TracesListView({
  traces,
  selectedTraceId,
  onSelectTrace,
  recentlyAddedKeys,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
}: TracesListViewProps) {
  // --- Virtualisation state ---
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Measure the container on mount and resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => setContainerHeight(el.clientHeight);
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  // --- Visible range ---
  const totalCount = traces.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    totalCount,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleTraces = traces.slice(startIndex, endIndex);
  const totalHeight = totalCount * ROW_HEIGHT;
  const offsetY = startIndex * ROW_HEIGHT;

  // --- Infinite scroll sentinel via IntersectionObserver ---
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage) {
          fetchNextPage?.();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, fetchNextPage]);

  // --- Render ---
  return (
    <div data-testid="traces-list" className="flex h-full flex-col">
      {/* Column headers */}
      <div
        className="grid items-center border-b border-white/[0.06] bg-surface-50/40 px-3 text-[10px] uppercase tracking-[0.15em] text-gray-600"
        style={{
          gridTemplateColumns:
            "6rem 9rem 14rem minmax(8rem, 1fr) 14rem 6rem",
          height: `${ROW_HEIGHT}px`,
        }}
      >
        <span>Date</span>
        <span>Time</span>
        <span>Name</span>
        <span>Input</span>
        <span>Entity</span>
        <span>Status</span>
      </div>

      {/* Virtualised scroll container */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
      >
        {/* Total-height spacer */}
        <div style={{ height: `${totalHeight}px`, position: "relative" }}>
          {/* Visible rows */}
          <div style={{ position: "absolute", top: `${offsetY}px`, left: 0, right: 0 }}>
            {visibleTraces.map((trace) => {
              const spanName = trace.spans[0]?.name ?? "unknown";
              const spanUi = getSpanTypeUi(spanName);
              const isRecent = recentlyAddedKeys?.has(trace.traceId) ?? false;
              const isSelected = trace.traceId === selectedTraceId;
              const inputPreview = getInputPreview(trace.input);
              const statusClass =
                STATUS_STYLES[trace.status] ?? STATUS_STYLES.unset;

              return (
                <div
                  key={trace.traceId}
                  data-testid={`trace-row-${trace.traceId}`}
                  onClick={() => onSelectTrace(trace.traceId)}
                  className={`grid cursor-pointer items-center border-b border-white/[0.02] px-3 text-xs transition-colors hover:bg-white/[0.02] ${
                    isSelected ? "bg-cyan-500/[0.06]" : ""
                  } ${isRecent ? "animate-row-highlight" : ""}`}
                  style={{
                    gridTemplateColumns:
                      "6rem 9rem 14rem minmax(8rem, 1fr) 14rem 6rem",
                    height: `${ROW_HEIGHT}px`,
                  }}
                >
                  {/* Date */}
                  <span
                    data-testid={`trace-date-${trace.traceId}`}
                    className="font-mono text-gray-500 truncate"
                  >
                    {formatDate(trace.startTime)}
                  </span>

                  {/* Time */}
                  <span
                    data-testid={`trace-time-${trace.traceId}`}
                    className="font-mono text-gray-500 truncate"
                  >
                    {formatTime(trace.startTime)}
                  </span>

                  {/* Name with colored type dot */}
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      data-testid={`trace-type-dot-${trace.traceId}`}
                      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${spanUi.dotClass}`}
                    />
                    <span className="text-gray-300 truncate">{spanName}</span>
                  </span>

                  {/* Input preview */}
                  <span
                    data-testid={`trace-input-${trace.traceId}`}
                    className="text-gray-500 truncate"
                    title={inputPreview}
                  >
                    {inputPreview}
                  </span>

                  {/* Entity */}
                  <span className="text-gray-400 truncate">
                    {trace.entityName ?? "--"}
                  </span>

                  {/* Status badge */}
                  <span
                    data-testid={`trace-status-${trace.traceId}`}
                    className={`inline-flex w-fit items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${statusClass}`}
                  >
                    {statusLabel(trace.status)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} data-testid="scroll-sentinel" className="h-1" />

        {/* Loading indicator */}
        {isFetchingNextPage && (
          <div
            data-testid="loading-more"
            className="flex items-center justify-center py-3"
          >
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400" />
          </div>
        )}
      </div>

      {/* Empty state */}
      {traces.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12">
          <p className="text-sm text-gray-600">No traces recorded yet</p>
        </div>
      )}
    </div>
  );
}
