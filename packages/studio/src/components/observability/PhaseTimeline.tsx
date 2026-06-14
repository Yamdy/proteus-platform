import type { PhaseEvent, PhaseName } from "../../hooks/useObservability";

interface PhaseTimelineProps {
  events: PhaseEvent[];
  wsConnected: boolean;
  onClear: () => void;
}

const PHASE_ORDER: PhaseName[] = [
  "context_assembly",
  "llm_inference",
  "action_resolution",
  "tool_execution",
  "result_observation",
];

const PHASE_LABELS: Record<PhaseName, string> = {
  context_assembly: "Context Assembly",
  llm_inference: "LLM Inference",
  action_resolution: "Action Resolution",
  tool_execution: "Tool Execution",
  result_observation: "Result Observation",
};

const PHASE_COLORS: Record<PhaseName, string> = {
  context_assembly: "bg-cyan-400",
  llm_inference: "bg-purple-400",
  action_resolution: "bg-amber-400",
  tool_execution: "bg-teal-400",
  result_observation: "bg-emerald-400",
};

const PHASE_GLOW: Record<PhaseName, string> = {
  context_assembly: "shadow-[0_0_6px_rgba(34,211,238,0.4)]",
  llm_inference: "shadow-[0_0_6px_rgba(168,85,247,0.4)]",
  action_resolution: "shadow-[0_0_6px_rgba(251,191,36,0.4)]",
  tool_execution: "shadow-[0_0_6px_rgba(45,212,191,0.4)]",
  result_observation: "shadow-[0_0_6px_rgba(52,211,153,0.4)]",
};

const STATUS_COLORS: Record<string, string> = {
  started: "border-amber-500/30 bg-amber-500/[0.06]",
  completed: "border-emerald-500/30 bg-emerald-500/[0.06]",
  error: "border-red-500/30 bg-red-500/[0.06]",
};

function formatDuration(ms?: number): string {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function groupByTrace(events: PhaseEvent[]): Map<string, PhaseEvent[]> {
  const groups = new Map<string, PhaseEvent[]>();
  for (const event of events) {
    const existing = groups.get(event.traceId) ?? [];
    existing.push(event);
    groups.set(event.traceId, existing);
  }
  return groups;
}

function TracePipeline({ events }: { events: PhaseEvent[] }) {
  const phaseMap = new Map<PhaseName, PhaseEvent>();
  for (const event of events) {
    const existing = phaseMap.get(event.phase);
    if (!existing || event.timestamp > existing.timestamp) {
      phaseMap.set(event.phase, event);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {PHASE_ORDER.map((phase) => {
        const event = phaseMap.get(phase);
        const dotColor = PHASE_COLORS[phase];
        const dotGlow = PHASE_GLOW[phase];
        const statusClass = event ? STATUS_COLORS[event.status] ?? "" : "";
        const isActive = event?.status === "started";

        return (
          <div key={phase} className="flex items-center gap-1.5">
            <div
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] transition-all duration-300 ${
                event
                  ? statusClass
                  : "border-white/[0.04] bg-surface-50/30 text-gray-700"
              } ${isActive ? "animate-pulse" : ""}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor} ${
                  event ? dotGlow : ""
                }`}
              />
              <span className={event ? "text-gray-300" : "text-gray-700"}>
                {PHASE_LABELS[phase]}
              </span>
              {event?.duration != null && (
                <span className="text-gray-600 font-mono">
                  {formatDuration(event.duration)}
                </span>
              )}
            </div>
            {phase !== "result_observation" && (
              <svg
                className="h-3 w-3 text-gray-800"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function PhaseTimeline({
  events,
  wsConnected,
  onClear,
}: PhaseTimelineProps) {
  const grouped = groupByTrace(events);
  const traceIds = Array.from(grouped.keys());

  return (
    <div data-testid="phase-timeline" className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between glass-panel-strong px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-200">
            Phase Timeline
          </h2>
          <div
            data-testid="ws-status"
            className="flex items-center gap-1.5"
          >
            <span className="relative flex h-2 w-2">
              {wsConnected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  wsConnected
                    ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]"
                    : "bg-red-500/70"
                }`}
              />
            </span>
            <span className="text-[10px] text-gray-600">
              {wsConnected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>
        <button
          onClick={onClear}
          className="rounded-md px-2.5 py-1 text-xs text-gray-500 transition-all hover:bg-white/[0.04] hover:text-gray-300"
        >
          Clear
        </button>
      </div>

      {/* Pipeline legend */}
      <div className="border-b border-white/[0.04] px-4 py-2">
        <div className="flex flex-wrap items-center gap-3 text-[10px]">
          <span className="text-gray-600">Phases:</span>
          {PHASE_ORDER.map((phase) => (
            <span key={phase} className="flex items-center gap-1">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${PHASE_COLORS[phase]}`}
              />
              <span className="text-gray-500">{PHASE_LABELS[phase]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Timeline entries */}
      <div className="flex-1 overflow-y-auto">
        {traceIds.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <div className="flex gap-1">
              {PHASE_ORDER.map((phase) => (
                <span
                  key={phase}
                  className={`h-1.5 w-1.5 rounded-full ${PHASE_COLORS[phase]} opacity-30 animate-glow-pulse`}
                  style={{
                    animationDelay: `${PHASE_ORDER.indexOf(phase) * 0.6}s`,
                  }}
                />
              ))}
            </div>
            <p className="text-sm text-gray-600">
              {wsConnected
                ? "Waiting for phase events..."
                : "Connect to see real-time phase transitions"}
            </p>
          </div>
        )}

        {traceIds.map((traceId) => {
          const traceEvents = grouped.get(traceId) ?? [];
          const latestEvent = traceEvents.reduce((a, b) =>
            a.timestamp > b.timestamp ? a : b,
          );
          const hasError = traceEvents.some((e) => e.status === "error");

          return (
            <div
              key={traceId}
              className={`border-b border-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.01] ${
                hasError ? "bg-red-500/[0.02]" : ""
              }`}
            >
              <div className="mb-2 flex items-center gap-3 text-[10px] text-gray-600">
                <span className="font-mono text-gray-500">
                  {traceId.slice(0, 12)}
                </span>
                {latestEvent.sessionId && (
                  <span className="font-mono">
                    session: {latestEvent.sessionId.slice(0, 8)}
                  </span>
                )}
                <span className="font-mono">
                  {formatTime(latestEvent.timestamp)}
                </span>
              </div>

              <TracePipeline events={traceEvents} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
