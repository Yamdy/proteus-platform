import { useState } from "react";
import type { ToolCallMetric } from "../../hooks/useObservability";

interface ToolCallCardProps {
  toolCall: ToolCallMetric;
}

function formatDuration(ms?: number): string {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatJSON(value: unknown): string {
  if (value == null) return "null";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isError = toolCall.status === "error";

  return (
    <div
      data-testid={`tool-call-${toolCall.id}`}
      className={`rounded-lg border transition-colors ${
        isError
          ? "border-red-800 bg-red-950/20"
          : "border-gray-800 bg-gray-900/50"
      }`}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        data-testid={`tool-call-toggle-${toolCall.id}`}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isError ? "bg-red-500" : "bg-green-500"
            }`}
          />

          {/* Tool name */}
          <span className="text-sm font-medium text-white">
            {toolCall.toolName}
          </span>

          {/* Status badge */}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              isError
                ? "bg-red-900 text-red-300"
                : "bg-green-900 text-green-300"
            }`}
          >
            {toolCall.status}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Duration */}
          <span className="text-xs text-gray-500">
            {formatDuration(toolCall.duration)}
          </span>

          {/* Timestamp */}
          <span className="text-[10px] text-gray-600">
            {formatTime(toolCall.startTime)}
          </span>

          {/* Expand icon */}
          <svg
            className={`h-4 w-4 text-gray-500 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
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
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-800 px-4 py-3 space-y-3">
          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-4 text-[10px] text-gray-500">
            <span>
              ID: <span className="font-mono text-gray-400">{toolCall.id.slice(0, 12)}</span>
            </span>
            <span>
              Trace: <span className="font-mono text-gray-400">{toolCall.traceId.slice(0, 12)}</span>
            </span>
          </div>

          {/* Parameters */}
          {toolCall.parameters && (
            <div>
              <h4 className="mb-1 text-xs font-medium text-gray-400">
                Parameters
              </h4>
              <pre className="overflow-x-auto rounded-md bg-gray-950 p-3 text-xs text-gray-300">
                {formatJSON(toolCall.parameters)}
              </pre>
            </div>
          )}

          {/* Result */}
          {toolCall.result != null && (
            <div>
              <h4 className="mb-1 text-xs font-medium text-gray-400">
                Result
              </h4>
              <pre className="overflow-x-auto rounded-md bg-gray-950 p-3 text-xs text-gray-300">
                {formatJSON(toolCall.result)}
              </pre>
            </div>
          )}

          {/* Error */}
          {toolCall.error && (
            <div>
              <h4 className="mb-1 text-xs font-medium text-red-400">Error</h4>
              <pre className="overflow-x-auto rounded-md bg-red-950/30 p-3 text-xs text-red-300">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
