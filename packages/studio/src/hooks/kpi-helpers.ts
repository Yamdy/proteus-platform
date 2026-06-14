// Pure helpers for KPI metrics — no React dependency, unit-testable.

import { formatCost } from "../lib/format";
export { formatCost };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricsFilters {
  sessionId?: string;
  since?: number;
  until?: number;
  [key: string]: string | number | undefined;
}

export interface AggregateResponse {
  value: number;
  previousValue?: number;
  changePercent?: number;
}

export interface KpiResult {
  value: number;
  previousValue: number;
  changePercent: number;
  isLoading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without React)
// ---------------------------------------------------------------------------

/** Format a number with compact suffix (K / M / B). */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  if (!Number.isInteger(value)) {
    return value.toFixed(1);
  }
  return String(value);
}

/** Compute error-rate percentage (returns 0 when denominator is 0). */
export function computeErrorRate(errors: number, total: number): number {
  if (total === 0) return 0;
  return (errors / total) * 100;
}

/** Sum input and output token counts. */
export function mergeTokenValues(input: number, output: number): number {
  return input + output;
}

/** Build the POST body for /api/metrics/aggregate. */
export function buildAggregateBody(
  metric: string,
  filters?: MetricsFilters,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    metric,
    comparePeriod: "previous_period",
  };
  if (filters) {
    body.filters = filters;
  }
  return body;
}
