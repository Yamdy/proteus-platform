/**
 * Drilldown helpers for navigating from metrics cards to filtered traces/logs views.
 */

/** Base filter shape for metrics views — extensible by consumers. */
export interface MetricsDimensionalFilter {
  sessionId?: string;
  status?: string;
  model?: string;
  entityType?: string;
  entityName?: string;
  [key: string]: string | undefined;
}

export interface BuildTracesDrilldownUrlOpts {
  baseUrl?: string;
  filters: MetricsDimensionalFilter;
  scope?: {
    entityType?: string;
    entityName?: string;
    status?: string;
  };
  timestamp?: { start: number; end: number };
}

/**
 * Constructs a URL to /observability?tab=traces with all current filters
 * merged with per-card scope overrides and optional timestamp range.
 */
export function buildTracesDrilldownUrl(opts: BuildTracesDrilldownUrlOpts): string {
  const base = opts.baseUrl ?? "/observability";
  const params = new URLSearchParams();

  params.set("tab", "traces");

  // Apply base filters
  const merged: Record<string, string | undefined> = { ...opts.filters };

  // Scope overrides take precedence
  if (opts.scope) {
    if (opts.scope.entityType !== undefined) merged.entityType = opts.scope.entityType;
    if (opts.scope.entityName !== undefined) merged.entityName = opts.scope.entityName;
    if (opts.scope.status !== undefined) merged.status = opts.scope.status;
  }

  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }

  if (opts.timestamp) {
    params.set("start", String(opts.timestamp.start));
    params.set("end", String(opts.timestamp.end));
  }

  return `${base}?${params.toString()}`;
}

export interface NarrowWindowOpts {
  timestamp: number;
  interval: "1h" | "6h" | "1d";
}

/**
 * Computes bucket start/end from a chart point timestamp and interval.
 * - 1h: floor to hour, +1h
 * - 6h: floor to 6h block, +6h
 * - 1d: floor to day start (UTC midnight), +1d
 */
export function narrowWindowToBucket(opts: NarrowWindowOpts): {
  start: number;
  end: number;
} {
  const d = new Date(opts.timestamp);

  switch (opts.interval) {
    case "1h": {
      const start = new Date(d);
      start.setUTCMinutes(0, 0, 0);
      const end = new Date(start);
      end.setUTCHours(end.getUTCHours() + 1);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "6h": {
      const start = new Date(d);
      start.setUTCHours(Math.floor(start.getUTCHours() / 6) * 6, 0, 0, 0);
      const end = new Date(start);
      end.setUTCHours(end.getUTCHours() + 6);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "1d": {
      const start = new Date(d);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { start: start.getTime(), end: end.getTime() };
    }
  }
}
