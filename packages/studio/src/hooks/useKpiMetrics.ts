import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api.js";
import type { MetricsFilters, AggregateResponse, KpiResult } from "./kpi-helpers.js";
import { computeErrorRate, mergeTokenValues, buildAggregateBody } from "./kpi-helpers.js";

// Re-export helpers so consumers can import everything from this module
export {
  formatCompact,
  computeErrorRate,
  mergeTokenValues,
  buildAggregateBody,
} from "./kpi-helpers.js";
export type { MetricsFilters, AggregateResponse, KpiResult } from "./kpi-helpers.js";

// ---------------------------------------------------------------------------
// Internal: shared fetch helper
// ---------------------------------------------------------------------------

async function fetchAggregate(
  metric: string,
  filters?: MetricsFilters,
): Promise<AggregateResponse> {
  const body = buildAggregateBody(metric, filters);
  return apiFetch<AggregateResponse>("/api/metrics/aggregate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Internal: generic KPI hook factory
// ---------------------------------------------------------------------------

function useKpiQuery(
  metricName: string,
  filters?: MetricsFilters,
  filterKey?: string,
  transform?: (res: AggregateResponse) => AggregateResponse,
): KpiResult {
  const [value, setValue] = useState(0);
  const [previousValue, setPreviousValue] = useState(0);
  const [changePercent, setChangePercent] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchAggregate(metricName, filters);
      const data = transform ? transform(res) : res;
      setValue(data.value);
      setPreviousValue(data.previousValue ?? 0);
      setChangePercent(data.changePercent ?? 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
    // filterKey is the stable dep; filters object may change reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricName, filterKey]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { value, previousValue, changePercent, isLoading, error };
}

// ---------------------------------------------------------------------------
// Public KPI hooks
// ---------------------------------------------------------------------------

/** Agent Runs — count of agent_duration_ms events. */
export function useAgentRunsKpiMetrics(
  filters?: MetricsFilters,
  filterKey?: string,
): KpiResult {
  return useKpiQuery("agent_runs", filters, filterKey);
}

/** Model Cost — sum of estimatedCost. */
export function useModelCostKpiMetrics(
  filters?: MetricsFilters,
  filterKey?: string,
): KpiResult {
  return useKpiQuery("model_cost", filters, filterKey);
}

/** Total Tokens — 2 parallel calls merged client-side. */
export function useTotalTokensKpiMetrics(
  filters?: MetricsFilters,
  filterKey?: string,
): KpiResult {
  const [value, setValue] = useState(0);
  const [previousValue, setPreviousValue] = useState(0);
  const [changePercent, setChangePercent] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [inputRes, outputRes] = await Promise.all([
        fetchAggregate("input_tokens", filters),
        fetchAggregate("output_tokens", filters),
      ]);
      const current = mergeTokenValues(inputRes.value, outputRes.value);
      const prev = mergeTokenValues(
        inputRes.previousValue ?? 0,
        outputRes.previousValue ?? 0,
      );
      setValue(current);
      setPreviousValue(prev);
      setChangePercent(prev === 0 ? 0 : ((current - prev) / prev) * 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { value, previousValue, changePercent, isLoading, error };
}

/** Active Threads — count_distinct threadId. */
export function useActiveThreadsKpiMetrics(
  filters?: MetricsFilters,
  filterKey?: string,
): KpiResult {
  return useKpiQuery("active_threads", filters, filterKey);
}

/** Error Rate — errors / total * 100. */
export function useErrorRateKpiMetrics(
  filters?: MetricsFilters,
  filterKey?: string,
): KpiResult {
  const [value, setValue] = useState(0);
  const [previousValue, setPreviousValue] = useState(0);
  const [changePercent, setChangePercent] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const doFetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [errorRes, totalRes] = await Promise.all([
        fetchAggregate("error_count", filters),
        fetchAggregate("total_count", filters),
      ]);
      const rate = computeErrorRate(errorRes.value, totalRes.value);
      const prevRate = computeErrorRate(
        errorRes.previousValue ?? 0,
        totalRes.previousValue ?? 0,
      );
      setValue(rate);
      setPreviousValue(prevRate);
      setChangePercent(prevRate === 0 ? 0 : ((rate - prevRate) / prevRate) * 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return { value, previousValue, changePercent, isLoading, error };
}
