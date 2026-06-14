import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { CostSummary, CostEntry } from "../../hooks/useObservability";

interface CostDashboardProps {
  costs: CostSummary | null;
  loading: boolean;
  onRefresh: () => void;
  onFilterSession?: (sessionId: string | null) => void;
}

const PIE_COLORS = [
  "#22d3ee",
  "#2dd4bf",
  "#a78bfa",
  "#818cf8",
  "#67e8f9",
  "#5eead4",
];

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export default function CostDashboard({
  costs,
  loading,
  onRefresh,
  onFilterSession,
}: CostDashboardProps) {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [view, setView] = useState<"tokens" | "cost">("cost");

  const handleSessionFilter = (sessionId: string | null) => {
    setSelectedSession(sessionId);
    onFilterSession?.(sessionId);
  };

  if (loading && !costs) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400" />
      </div>
    );
  }

  if (!costs) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-gray-600">No cost data available</p>
        <button
          onClick={onRefresh}
          className="rounded-md px-3 py-1.5 text-xs text-gray-500 transition-all hover:bg-white/[0.04] hover:text-gray-300"
        >
          Refresh
        </button>
      </div>
    );
  }

  const barData = costs.byModel.map((m) => ({
    name: m.model,
    cost: m.costUsd,
    tokens: m.tokens,
  }));

  const pieData = costs.bySession.map((s) => ({
    name: s.sessionId.slice(0, 8),
    value: view === "cost" ? s.costUsd : s.tokens,
    sessionId: s.sessionId,
  }));

  return (
    <div
      data-testid="cost-dashboard"
      className="flex h-full flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between glass-panel-strong px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-200">
          Cost Dashboard
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="rounded-md px-2.5 py-1 text-xs text-gray-500 transition-all hover:bg-white/[0.04] hover:text-gray-300 disabled:opacity-50"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div
        data-testid="cost-summary"
        className="grid grid-cols-2 gap-3 border-b border-white/[0.04] p-4"
      >
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-gray-600">
            Total Cost
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-100 text-glow-subtle">
            {formatUsd(costs.totalCostUsd)}
          </p>
        </div>
        <div className="glass-panel rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-[0.15em] text-gray-600">
            Total Tokens
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-100 text-glow-subtle">
            {formatTokens(costs.totalTokens)}
          </p>
        </div>
      </div>

      {/* Session filter */}
      {selectedSession && (
        <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2">
          <span className="text-xs text-gray-600">Filtered by session:</span>
          <span className="font-mono text-xs text-cyan-400/60">
            {selectedSession.slice(0, 12)}
          </span>
          <button
            onClick={() => handleSessionFilter(null)}
            className="text-xs text-red-400/60 transition-colors hover:text-red-400"
          >
            Clear
          </button>
        </div>
      )}

      {/* Charts */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-lg bg-surface-50/60 p-0.5 border border-white/[0.04]">
          <button
            onClick={() => setView("cost")}
            className={`rounded-md px-3 py-1.5 text-xs transition-all duration-200 ${
              view === "cost"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            By Cost
          </button>
          <button
            onClick={() => setView("tokens")}
            className={`rounded-md px-3 py-1.5 text-xs transition-all duration-200 ${
              view === "tokens"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20"
                : "text-gray-600 hover:text-gray-400"
            }`}
          >
            By Tokens
          </button>
        </div>

        {/* Bar chart: cost by model */}
        {barData.length > 0 && (
          <div className="glass-panel rounded-xl p-4">
            <h3 className="mb-3 text-xs font-medium text-gray-500">
              Cost by Model
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.03)"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#6b7280" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.04)" }}
                  tickLine={false}
                  tickFormatter={
                    view === "cost"
                      ? (v: number) => `$${v.toFixed(2)}`
                      : formatTokens
                  }
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(12,16,24,0.95)",
                    border: "1px solid rgba(34,211,238,0.1)",
                    borderRadius: "8px",
                    fontSize: "11px",
                    color: "#e5e7eb",
                    backdropFilter: "blur(12px)",
                  }}
                  formatter={
                    view === "cost"
                      ? (v: number) => [formatUsd(v), "Cost"]
                      : (v: number) => [formatTokens(v), "Tokens"]
                  }
                />
                <Bar
                  dataKey={view === "cost" ? "cost" : "tokens"}
                  fill="url(#barGradient)"
                  radius={[4, 4, 0, 0]}
                />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#0e7490" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Pie chart: distribution by session */}
        {pieData.length > 0 && (
          <div className="glass-panel rounded-xl p-4">
            <h3 className="mb-3 text-xs font-medium text-gray-500">
              Distribution by Session
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                  onClick={(data) => {
                    if (data?.sessionId) {
                      handleSessionFilter(data.sessionId);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {pieData.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                      stroke="transparent"
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(12,16,24,0.95)",
                    border: "1px solid rgba(34,211,238,0.1)",
                    borderRadius: "8px",
                    fontSize: "11px",
                    color: "#e5e7eb",
                    backdropFilter: "blur(12px)",
                  }}
                  formatter={(v: number) =>
                    view === "cost" ? formatUsd(v) : formatTokens(v)
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: "10px", color: "#6b7280" }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Turn-level table */}
        {costs.byTurn.length > 0 && (
          <div className="glass-panel rounded-xl overflow-hidden">
            <h3 className="border-b border-white/[0.04] px-4 py-2.5 text-xs font-medium text-gray-500">
              Per-Turn Breakdown
            </h3>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.04] text-left text-gray-600">
                    <th className="px-4 py-2 font-medium">Time</th>
                    <th className="px-4 py-2 font-medium">Model</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Prompt
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Completion
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.byTurn.map((entry: CostEntry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-white/[0.02] transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-2 text-gray-500 font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-4 py-2 text-gray-300">{entry.model}</td>
                      <td className="px-4 py-2 text-right text-gray-500 font-mono">
                        {formatTokens(entry.promptTokens)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-500 font-mono">
                        {formatTokens(entry.completionTokens)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-cyan-300">
                        {formatUsd(entry.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
