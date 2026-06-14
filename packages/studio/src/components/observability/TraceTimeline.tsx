import { useMemo, useState, useCallback } from "react";
import type { UISpan } from "../../hooks/useTraceSpanNavigation";
import {
  type SpanType,
  deriveSpanType,
  getSpanTypeUi,
} from "./timeline-types";

// --- Props ---

interface TraceTimelineProps {
  spans: UISpan[];
  searchQuery?: string;
  fadedTypes?: Set<string>;
}

// --- Tree helpers ---

interface SpanNode {
  span: UISpan;
  children: SpanNode[];
  depth: number;
}

function buildTree(spans: UISpan[]): SpanNode[] {
  const roots: SpanNode[] = [];

  // First pass: create nodes
  const nodes = spans.map((span) => ({
    span,
    children: [] as SpanNode[],
    depth: 0,
  }));
  const nodeMap = new Map(nodes.map((n) => [n.span.id, n]));

  // Second pass: wire parent-child
  for (const node of nodes) {
    const parentId = node.span.parentSpanId;
    if (parentId && nodeMap.has(parentId)) {
      const parent = nodeMap.get(parentId)!;
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function getAllDescendantIds(node: SpanNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(child.span.id);
    ids.push(...getAllDescendantIds(child));
  }
  return ids;
}

function findNodeById(nodes: SpanNode[], id: string): SpanNode | null {
  for (const n of nodes) {
    if (n.span.id === id) return n;
    const found = findNodeById(n.children, id);
    if (found) return found;
  }
  return null;
}

function findAncestorIds(
  roots: SpanNode[],
  targetId: string,
): string[] {
  const path: string[] = [];
  function dfs(nodes: SpanNode[], ancestors: string[]): boolean {
    for (const node of nodes) {
      if (node.span.id === targetId) {
        path.push(...ancestors);
        return true;
      }
      if (dfs(node.children, [...ancestors, node.span.id])) return true;
    }
    return false;
  }
  dfs(roots, []);
  return path;
}

// --- Gantt math ---

function computeGanttMetrics(
  spans: UISpan[],
) {
  if (spans.length === 0)
    return { rootStart: 0, overallLatency: 1 };
  const starts = spans.map((s) => s.startTime);
  const ends = spans.map((s) =>
    s.endTime ?? (s.startTime + (s.duration ?? 0)),
  );
  const rootStart = Math.min(...starts);
  const rootEnd = Math.max(...ends);
  const overallLatency = Math.max(rootEnd - rootStart, 1);
  return { rootStart, overallLatency };
}

// --- Helpers ---

function getSpanLatency(span: UISpan): number {
  if (span.duration != null) return span.duration;
  if (span.endTime != null) return span.endTime - span.startTime;
  return 0;
}

function getSpanType(span: UISpan): SpanType {
  if (span.type) return span.type as SpanType;
  return deriveSpanType(span.name);
}

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// --- TraceTimelineSpan (recursive) ---

interface TraceTimelineSpanProps {
  node: SpanNode;
  rootStart: number;
  overallLatency: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onExpandAll: (id: string) => void;
  onCollapseAll: (id: string) => void;
  featuredIds: Set<string> | null;
  fadedTypes: Set<string>;
  searchQuery: string;
}

function TraceTimelineSpan({
  node,
  rootStart,
  overallLatency,
  expandedIds,
  onToggle,
  onExpandAll,
  onCollapseAll,
  featuredIds,
  fadedTypes,
  searchQuery,
}: TraceTimelineSpanProps) {
  const { span, children, depth } = node;
  const type = getSpanType(span);
  const typeUi = getSpanTypeUi(type);
  const latency = getSpanLatency(span);
  const isExpanded = expandedIds.has(span.id);
  const hasChildren = children.length > 0;

  // Fading logic
  const isFadedByType = fadedTypes.has(type);
  const isFadedBySearch =
    searchQuery.length > 0 &&
    featuredIds !== null &&
    !featuredIds.has(span.id);
  const isFaded = isFadedByType || isFadedBySearch;

  // Gantt bar
  const leftPct = ((span.startTime - rootStart) / overallLatency) * 100;
  const widthPct = (latency / overallLatency) * 100;

  // Tooltip state
  const [hovering, setHovering] = useState(false);

  return (
    <>
      {/* Three flat siblings into the grid */}
      <div
        data-testid={`span-row-${span.id}`}
        className={`contents ${isFaded ? "opacity-30" : ""} ${
          isFadedByType ? "hover:opacity-60" : ""
        }`}
      >
        {/* Column 1: Name */}
        <div
          data-testid={`span-name-${span.id}`}
          data-has-connector={depth > 0 ? "true" : "false"}
          className="flex items-center gap-2 truncate px-2 py-1 text-xs text-gray-300"
          style={{ paddingLeft: `${depth}rem` }}
        >
          {/* Tree connector line */}
          {depth > 0 && (
            <span
              data-testid={`connector-${span.id}`}
              className="inline-block w-3 border-l border-b border-white/[0.08]"
              style={{ height: "0.6rem" }}
            />
          )}
          {/* Type dot */}
          <span
            className="inline-block h-2 w-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: typeUi.color }}
          />
          {/* Span name */}
          <span className="truncate">{span.name}</span>
        </div>

        {/* Column 2: Expand controls */}
        <div className="flex items-center gap-1 px-1">
          {hasChildren && (
            <>
              <button
                data-testid={`expand-toggle-${span.id}`}
                onClick={() => onToggle(span.id)}
                className="rounded p-0.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-300"
                title={isExpanded ? "Collapse" : "Expand"}
              >
                <svg
                  className={`h-3 w-3 transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
              <button
                data-testid={`expand-all-${span.id}`}
                onClick={() => onExpandAll(span.id)}
                className="rounded p-0.5 text-gray-600 hover:bg-white/[0.06] hover:text-gray-400"
                title={`Expand all ${getAllDescendantIds(node).length} descendants`}
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              <button
                data-testid={`collapse-all-${span.id}`}
                onClick={() => onCollapseAll(span.id)}
                className="rounded p-0.5 text-gray-600 hover:bg-white/[0.06] hover:text-gray-400"
                title={`Collapse all ${getAllDescendantIds(node).length} descendants`}
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Column 3: Gantt bar */}
        <div
          className="relative flex items-center px-2"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          <div
            data-testid={`gantt-bar-${span.id}`}
            className="absolute h-3 rounded-sm transition-all"
            style={{
              left: `${leftPct}%`,
              width: `${Math.max(widthPct, 0.5)}%`,
              backgroundColor: typeUi.color,
              opacity: 0.8,
            }}
          />
          {/* Tooltip */}
          {hovering && (
            <div
              data-testid="gantt-tooltip"
              className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/[0.08] bg-gray-900/95 px-2 py-1 text-[10px] text-gray-300 shadow-lg backdrop-blur"
            >
              <div>Latency: {formatDuration(latency)}</div>
              <div>
                Start: +{formatDuration(span.startTime - rootStart)}
              </div>
              <div>
                End: +
                {formatDuration(
                  (span.endTime ?? span.startTime + latency) - rootStart,
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Render children recursively if expanded */}
      {isExpanded &&
        children.map((child) => (
          <TraceTimelineSpan
            key={child.span.id}
            node={child}
            rootStart={rootStart}
            overallLatency={overallLatency}
            expandedIds={expandedIds}
            onToggle={onToggle}
            onExpandAll={onExpandAll}
            onCollapseAll={onCollapseAll}
            featuredIds={featuredIds}
            fadedTypes={fadedTypes}
            searchQuery={searchQuery}
          />
        ))}
    </>
  );
}

// --- TraceTimeline (main export) ---

export function TraceTimeline({
  spans,
  searchQuery = "",
  fadedTypes = new Set(),
}: TraceTimelineProps) {
  // Build tree
  const roots = useMemo(() => buildTree(spans), [spans]);

  // Gantt metrics
  const { rootStart, overallLatency } = useMemo(
    () => computeGanttMetrics(spans),
    [spans],
  );

  // Expanded state: start with everything collapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(
    (id: string) => {
      const node = findNodeById(roots, id);
      if (!node) return;
      const allIds = [id, ...getAllDescendantIds(node)];
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const i of allIds) next.add(i);
        return next;
      });
    },
    [roots],
  );

  const collapseAll = useCallback(
    (id: string) => {
      const node = findNodeById(roots, id);
      if (!node) return;
      const allIds = [id, ...getAllDescendantIds(node)];
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const i of allIds) next.delete(i);
        return next;
      });
    },
    [roots],
  );

  // Search: auto-expand ancestors of matching spans
  const featuredIds = useMemo(() => {
    if (!searchQuery) return null;
    const ids = new Set<string>();
    for (const span of spans) {
      if (span.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        ids.add(span.id);
      }
    }
    return ids;
  }, [spans, searchQuery]);

  // Auto-expand ancestors when search is active
  const effectiveExpanded = useMemo(() => {
    if (!featuredIds || featuredIds.size === 0) return expandedIds;
    const next = new Set(expandedIds);
    for (const fid of featuredIds) {
      const ancestors = findAncestorIds(roots, fid);
      for (const a of ancestors) next.add(a);
    }
    return next;
  }, [expandedIds, featuredIds, roots]);

  // Collect present types for legend
  const presentTypes = useMemo(() => {
    const types = new Set<SpanType>();
    for (const span of spans) {
      types.add(getSpanType(span));
    }
    return Array.from(types);
  }, [spans]);

  return (
    <div
      data-testid="trace-timeline"
      className="grid grid-cols-[minmax(0,1fr)_auto_auto]"
    >
      {/* Legend bar */}
      <div
        data-testid="legend"
        className="col-span-3 flex gap-2 border-b border-white/[0.04] p-2"
      >
        {presentTypes.map((type) => {
          const ui = getSpanTypeUi(type);
          return (
            <span
              key={type}
              className="flex items-center gap-1 text-[10px] text-gray-500"
            >
              <span
                data-testid="legend-dot"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: ui.color }}
              />
              {ui.label}
            </span>
          );
        })}
      </div>

      {/* Span rows rendered recursively */}
      {roots.map((root) => (
        <TraceTimelineSpan
          key={root.span.id}
          node={root}
          rootStart={rootStart}
          overallLatency={overallLatency}
          expandedIds={effectiveExpanded}
          onToggle={toggle}
          onExpandAll={expandAll}
          onCollapseAll={collapseAll}
          featuredIds={featuredIds}
          fadedTypes={fadedTypes}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
}
