import { useCallback, useState } from "react";
import { useMetricsFilters } from "../../hooks/useMetricsFilters";

export default function MetricsFilterBar() {
  const { filters, setFilterTokens } = useMetricsFilters();
  const current = filters.dimensionalFilter;

  const [entityType, setEntityType] = useState(current.entityType ?? "");
  const [entityName, setEntityName] = useState(current.entityName ?? "");
  const [sessionId, setSessionId] = useState(current.sessionId ?? "");
  const [tagsInput, setTagsInput] = useState(
    current.tags?.join(", ") ?? "",
  );

  const applyFilters = useCallback(() => {
    const tokens: Record<string, string | string[]> = {};
    if (entityType.trim()) tokens.entityType = entityType.trim();
    if (entityName.trim()) tokens.entityName = entityName.trim();
    if (sessionId.trim()) tokens.sessionId = sessionId.trim();
    if (tagsInput.trim()) {
      tokens.tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    setFilterTokens(tokens);
  }, [entityType, entityName, sessionId, tagsInput, setFilterTokens]);

  const clearFilters = useCallback(() => {
    setEntityType("");
    setEntityName("");
    setSessionId("");
    setTagsInput("");
    setFilterTokens({});
  }, [setFilterTokens]);

  return (
    <div
      data-testid="metrics-filter-bar"
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-widest text-gray-600">
          Entity Type
        </label>
        <input
          data-testid="filter-entity-type"
          type="text"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          placeholder="e.g. tool, agent"
          className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2.5 py-1.5 text-xs text-gray-300 placeholder:text-gray-700 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none w-32"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-widest text-gray-600">
          Entity Name
        </label>
        <input
          data-testid="filter-entity-name"
          type="text"
          value={entityName}
          onChange={(e) => setEntityName(e.target.value)}
          placeholder="e.g. search-agent"
          className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2.5 py-1.5 text-xs text-gray-300 placeholder:text-gray-700 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none w-36"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-widest text-gray-600">
          Session ID
        </label>
        <input
          data-testid="filter-session-id"
          type="text"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="e.g. sess-abc"
          className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2.5 py-1.5 text-xs text-gray-300 placeholder:text-gray-700 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none w-36"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-widest text-gray-600">
          Tags
        </label>
        <input
          data-testid="filter-tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="prod, v2"
          className="rounded-md border border-white/[0.08] bg-surface-50/60 px-2.5 py-1.5 text-xs text-gray-300 placeholder:text-gray-700 transition-colors hover:border-white/[0.12] focus:border-cyan-500/30 focus:outline-none w-36"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          data-testid="filter-apply"
          onClick={applyFilters}
          className="rounded-md bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 text-xs text-cyan-300 transition-all hover:bg-cyan-500/20"
        >
          Apply
        </button>
        <button
          data-testid="filter-clear"
          onClick={clearFilters}
          className="rounded-md px-3 py-1.5 text-xs text-gray-600 transition-all hover:bg-white/[0.04] hover:text-gray-400"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
