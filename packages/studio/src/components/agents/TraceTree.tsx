import { useAgentStore } from "../../stores/agentStore";
import type { TraceSpan } from "../../stores/agentStore";

export default function TraceTree() {
  const { traceTree } = useAgentStore();

  if (!traceTree) {
    return (
      <div
        data-testid="trace-tree-empty"
        className="flex h-full items-center justify-center"
      >
        <p className="text-xs text-gray-600">No trace data</p>
      </div>
    );
  }

  return (
    <div data-testid="trace-tree" className="h-full overflow-auto p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">Trace Tree</h3>
      <TraceNode node={traceTree} depth={0} />
    </div>
  );
}

function TraceNode({ node, depth }: { node: TraceSpan; depth: number }) {
  const duration =
    node.endTime && node.startTime
      ? node.endTime - node.startTime
      : null;

  const statusColor =
    node.status === "ok"
      ? "bg-green-400"
      : node.status === "error"
        ? "bg-red-400"
        : "bg-yellow-400 animate-pulse";

  return (
    <div style={{ marginLeft: depth > 0 ? "16px" : "0" }}>
      <div
        data-testid={`span-${node.spanId}`}
        className="group flex items-start gap-2 rounded px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
      >
        {/* Connector line */}
        {depth > 0 && (
          <span className="mt-2 inline-block h-px w-3 bg-gray-700" />
        )}

        {/* Status dot */}
        <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${statusColor}`} />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-medium text-gray-200">
              {node.name}
            </span>
            {duration !== null && (
              <span className="flex-shrink-0 text-[10px] font-mono text-gray-600">
                {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-gray-600">
              {node.agentId}
            </span>
            {node.attributes && Object.keys(node.attributes).length > 0 && (
              <span className="text-[10px] text-gray-700">
                {Object.entries(node.attributes)
                  .slice(0, 2)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(" · ")}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Children */}
      {node.children.length > 0 && (
        <div className="border-l border-gray-800 ml-3">
          {node.children.map((child) => (
            <TraceNode key={child.spanId} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
