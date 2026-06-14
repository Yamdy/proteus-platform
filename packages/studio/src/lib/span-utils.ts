import type { SpanRecord as CoreSpanRecord } from "@proteus-ai/core/schemas";

/**
 * Span record input — represents a single span from the tracing backend.
 * Re-exports from core with the local alias.
 */
export type SpanRecord = CoreSpanRecord;

/**
 * UI-ready span with nested children and computed latency.
 */
export interface UISpan {
  id: string;
  name: string;
  type: string;
  latency: number;
  startTime: number;
  endTime?: number;
  spans?: UISpan[];
  parentSpanId?: string;
}

/**
 * Transforms a flat list of SpanRecords into a hierarchical UISpan tree.
 *
 * Algorithm:
 * 1. Build lookup Map<spanId, SpanRecord>
 * 2. Identify roots (anchor span, or spans with no parent / parent not in map)
 * 3. Link children to parents
 * 4. Surface orphans (parent not in map) as roots
 * 5. Extend root endTime to max descendant endTime
 * 6. Recursive sort by startTime ascending
 * 7. Convert SpanRecord → UISpan (latency = endTime - startTime)
 */
export function formatHierarchicalSpans(
  spans: SpanRecord[],
  anchorSpanId?: string,
): UISpan[] {
  if (spans.length === 0) return [];

  // Step 1: Build lookup map (shallow copy so we can mutate children arrays)
  type SpanWithChildren = SpanRecord & { _children: SpanWithChildren[] };
  const byId = new Map<string, SpanWithChildren>();
  for (const s of spans) {
    byId.set(s.spanId, { ...s, _children: [] });
  }

  // Step 3: Link children to parents
  const childIds = new Set<string>();
  for (const s of byId.values()) {
    if (s.parentSpanId && byId.has(s.parentSpanId)) {
      byId.get(s.parentSpanId)!._children.push(s);
      childIds.add(s.spanId);
    }
  }

  // Step 2 & 4: Identify roots
  let roots: SpanWithChildren[];
  if (anchorSpanId) {
    const anchor = byId.get(anchorSpanId);
    if (!anchor) return [];
    roots = [anchor];
  } else {
    roots = [];
    for (const s of byId.values()) {
      // Root if: no parent, or parent not in map
      if (!s.parentSpanId || !byId.has(s.parentSpanId)) {
        roots.push(s);
      }
    }
  }

  // Step 5: Extend root endTime to max descendant endTime
  function maxDescendantEndTime(node: SpanWithChildren): number {
    let max = node.endTime ?? node.startTime;
    for (const child of node._children) {
      const childMax = maxDescendantEndTime(child);
      if (childMax > max) max = childMax;
    }
    return max;
  }

  for (const root of roots) {
    const maxEnd = maxDescendantEndTime(root);
    if (root.endTime === undefined || maxEnd > root.endTime) {
      root.endTime = maxEnd;
    }
  }

  // Step 6 & 7: Recursive sort + convert to UISpan
  function toUISpan(node: SpanWithChildren): UISpan {
    // Sort children by startTime ascending
    node._children.sort((a, b) => a.startTime - b.startTime);

    const children = node._children.map(toUISpan);
    const endTime = node.endTime ?? node.startTime;
    return {
      id: node.spanId,
      name: node.name,
      type: node.type,
      latency: endTime - node.startTime,
      startTime: node.startTime,
      endTime: node.endTime,
      spans: children,
      parentSpanId: node.parentSpanId,
    };
  }

  // Sort roots by startTime ascending too
  roots.sort((a, b) => a.startTime - b.startTime);
  return roots.map(toUISpan);
}
