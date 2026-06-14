import {
  useAgentRunsKpiMetrics,
  useModelCostKpiMetrics,
  useTotalTokensKpiMetrics,
  useActiveThreadsKpiMetrics,
  useErrorRateKpiMetrics,
  formatCompact,
} from "../../hooks/useKpiMetrics";
import type { MetricsFilters, KpiResult } from "../../hooks/useKpiMetrics";
import { KpiCard } from "../ui/KpiCard";
import { Spinner } from "../ui/Spinner";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface KpiGridPageProps {
  filters?: MetricsFilters;
  filterKey?: string;
}

// ---------------------------------------------------------------------------
// Single card wrapper with loading/error states
// ---------------------------------------------------------------------------

function KpiCardSlot({
  label,
  data,
  format = formatCompact,
  suffix,
  lowerIsBetter = false,
}: {
  label: string;
  data: KpiResult;
  format?: (v: number) => string;
  suffix?: string;
  lowerIsBetter?: boolean;
}) {
  return (
    <KpiCard>
      <KpiCard.Label>{label}</KpiCard.Label>
      {data.isLoading ? (
        <div className="flex h-10 items-center justify-center">
          <Spinner size="sm" />
        </div>
      ) : data.error ? (
        <p className="text-xs text-red-400 truncate" title={data.error}>
          {data.error}
        </p>
      ) : (
        <>
          <KpiCard.Value>
            {format(data.value)}
            {suffix && (
              <span className="ml-1 text-sm font-normal text-gray-500">
                {suffix}
              </span>
            )}
          </KpiCard.Value>
          <KpiCard.Change
            value={data.changePercent}
            lowerIsBetter={lowerIsBetter}
          />
        </>
      )}
    </KpiCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KpiGridPage({ filters, filterKey }: KpiGridPageProps) {
  const agentRuns = useAgentRunsKpiMetrics(filters, filterKey);
  const totalTokens = useTotalTokensKpiMetrics(filters, filterKey);
  const modelCost = useModelCostKpiMetrics(filters, filterKey);
  const activeThreads = useActiveThreadsKpiMetrics(filters, filterKey);
  const errorRate = useErrorRateKpiMetrics(filters, filterKey);

  const formatCost = (v: number) => `$${v.toFixed(4)}`;

  return (
    <div
      data-testid="kpi-grid-page"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 p-6"
    >
      <KpiCardSlot label="Agent Runs" data={agentRuns} />
      <KpiCardSlot label="Total Tokens" data={totalTokens} />
      <KpiCardSlot label="Total Cost" data={modelCost} format={formatCost} />
      <KpiCardSlot label="Active Threads" data={activeThreads} />
      <KpiCardSlot
        label="Error Rate"
        data={errorRate}
        suffix="%"
        lowerIsBetter
      />
    </div>
  );
}
