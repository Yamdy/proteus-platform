import { useEffect, useState } from "react";
import { useAgentStore } from "../../stores/agentStore";
import type { TenantInfo } from "../../stores/agentStore";
import { apiFetch } from "../../lib/api";

export default function AgentPanel() {
  const { tenants, selectedTenantId, setTenants, selectTenant } = useAgentStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch<{ tenants: TenantInfo[] }>("/api/tenants")
      .then((res) => setTenants(res.tenants))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setTenants]);

  return (
    <aside
      data-testid="agent-panel"
      className="flex h-full w-72 flex-col glass-panel-strong"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-300">Agents</h2>
        <span className="text-[10px] font-mono text-gray-600">
          {tenants.length} tenant{tenants.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tenant list */}
      <div data-testid="tenant-list" className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center py-6">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500/20 border-t-cyan-400" />
          </div>
        )}

        {!loading && tenants.length === 0 && (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-gray-600">No tenants</p>
            <p className="mt-1 text-[10px] text-gray-700">
              Run a manifest to create one
            </p>
          </div>
        )}

        {tenants.map((tenant) => (
          <TenantCard
            key={tenant.tenantId}
            tenant={tenant}
            selected={selectedTenantId === tenant.tenantId}
            onSelect={() =>
              selectTenant(
                selectedTenantId === tenant.tenantId ? null : tenant.tenantId,
              )
            }
          />
        ))}
      </div>
    </aside>
  );
}

function TenantCard({
  tenant,
  selected,
  onSelect,
}: {
  tenant: TenantInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const usage = tenant.usage;
  const quotaPct = usage && tenant.quotas?.maxTokensPerPeriod
    ? Math.round((usage.tokensUsed / tenant.quotas.maxTokensPerPeriod) * 100)
    : null;

  return (
    <div
      data-testid={`tenant-${tenant.tenantId}`}
      className={`mx-2 mb-2 cursor-pointer rounded-lg border transition-all duration-200 ${
        selected
          ? "border-cyan-500/30 bg-cyan-500/[0.06]"
          : "border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
      onClick={onSelect}
    >
      {/* Tenant header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-200">
            {tenant.name}
          </p>
          <p className="text-[10px] font-mono text-gray-600">
            {tenant.tenantId}
          </p>
        </div>
        <span className="ml-2 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-400">
          {tenant.agentCount} agent{tenant.agentCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Agent list (when expanded) */}
      {selected && (
        <div className="border-t border-white/[0.04] px-3 py-2">
          {tenant.agents.map((agentId) => (
            <div
              key={agentId}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-gray-400"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
              <span className="font-mono">{agentId}</span>
            </div>
          ))}

          {/* Quota bar */}
          {quotaPct !== null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-gray-500">
                <span>Token usage</span>
                <span>{quotaPct}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className={`h-full rounded-full transition-all ${
                    quotaPct > 90
                      ? "bg-red-500"
                      : quotaPct > 70
                        ? "bg-yellow-500"
                        : "bg-cyan-500"
                  }`}
                  style={{ width: `${Math.min(quotaPct, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
