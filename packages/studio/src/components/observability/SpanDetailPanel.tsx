import { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Copy, Check } from "lucide-react";
import type { UISpan } from "../../hooks/useTraceSpanNavigation";

// Re-export UISpan so tests can import from this file
export type { UISpan };

// --- Utilities ---

interface SpanTypeUi {
  label: string;
  color: string; // Tailwind text color class
  bgColor: string; // Tailwind bg color class
}

const SPAN_TYPE_MAP: Record<string, SpanTypeUi> = {
  llm: { label: "LLM", color: "text-purple-400", bgColor: "bg-purple-400" },
  tool: { label: "Tool", color: "text-teal-400", bgColor: "bg-teal-400" },
  chain: { label: "Chain", color: "text-cyan-400", bgColor: "bg-cyan-400" },
  retrieval: { label: "Retrieval", color: "text-amber-400", bgColor: "bg-amber-400" },
  agent: { label: "Agent", color: "text-emerald-400", bgColor: "bg-emerald-400" },
};

export function getSpanTypeUi(type: string): SpanTypeUi {
  return SPAN_TYPE_MAP[type] ?? { label: type, color: "text-gray-400", bgColor: "bg-gray-400" };
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}


function formatDuration(ms?: number): string {
  if (ms == null) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatJSON(value: unknown): string {
  if (value == null) return "null";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateId(id: string, maxLen = 12): string {
  if (id.length <= maxLen) return id;
  return id.slice(0, maxLen) + "...";
}

// --- Copy button ---

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: no clipboard API
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="ml-1 inline-flex items-center text-gray-600 hover:text-gray-300 transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// --- Token Usage Bar ---

function TokenUsageBar({
  tokens,
}: {
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
}) {
  const total = tokens.input + tokens.output;
  if (total === 0) return null;

  const inputPct = (tokens.input / total) * 100;
  const outputPct = (tokens.output / total) * 100;

  return (
    <div data-testid="token-usage-bar" className="space-y-2">
      <div className="text-[10px] uppercase tracking-[0.15em] text-gray-600">Token Usage</div>
      {/* Horizontal bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          data-testid="token-bar-input"
          className="bg-cyan-400 transition-all duration-300"
          style={{ width: `${inputPct}%` }}
        />
        <div
          data-testid="token-bar-output"
          className="bg-purple-400 transition-all duration-300"
          style={{ width: `${outputPct}%` }}
        />
      </div>
      {/* Breakdown */}
      <div data-testid="token-breakdown" className="flex flex-wrap gap-3 text-[10px]">
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />
          <span className="text-gray-500">Input:</span>
          <span className="font-mono text-gray-300">{tokens.input}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400" />
          <span className="text-gray-500">Output:</span>
          <span className="font-mono text-gray-300">{tokens.output}</span>
        </span>
        {tokens.cacheRead != null && tokens.cacheRead > 0 && (
          <span data-testid="token-cache-read" className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="text-gray-500">Cache Read:</span>
            <span className="font-mono text-gray-300">{tokens.cacheRead}</span>
          </span>
        )}
        {tokens.cacheWrite != null && tokens.cacheWrite > 0 && (
          <span data-testid="token-cache-write" className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="text-gray-500">Cache Write:</span>
            <span className="font-mono text-gray-300">{tokens.cacheWrite}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// --- Metadata Row ---

function MetaRow({ label, value, testId }: { label: string; value: React.ReactNode; testId: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-gray-600">{label}</span>
      <div data-testid={testId} className="flex items-center gap-1 font-mono text-xs text-gray-300">
        {value}
        {typeof value === "string" && <CopyButton text={value} />}
      </div>
    </div>
  );
}

// --- Code Section ---

function CodeSection({
  title,
  value,
  testId,
}: {
  title: string;
  value: unknown;
  testId: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const formatted = formatJSON(value);
  const isEmpty = value == null;

  return (
    <div data-testid={testId} className="rounded-lg border border-white/[0.04] overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between bg-white/[0.02] px-3 py-2 text-xs font-medium text-gray-400 hover:bg-white/[0.04] transition-colors"
      >
        <span>{title}</span>
        <svg
          className={`h-3 w-3 text-gray-600 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!collapsed && (
        <pre className="overflow-x-auto bg-surface/80 p-3 text-[11px] leading-relaxed text-gray-400 font-mono">
          {isEmpty ? <span className="text-gray-600 italic">No {title.toLowerCase()}</span> : formatted}
        </pre>
      )}
    </div>
  );
}

// --- Tab component ---

function TabButton({
  label,
  testId,
  active,
  onClick,
}: {
  label: string;
  testId: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      aria-selected={active}
      onClick={onClick}
      className={`relative border-b-2 px-4 py-2.5 text-xs font-medium transition-all duration-200 ${
        active
          ? "border-cyan-400/60 text-cyan-100"
          : "border-transparent text-gray-600 hover:text-gray-400"
      }`}
    >
      {label}
    </button>
  );
}

// --- Main Component ---

interface SpanDetailPanelProps {
  span: UISpan;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}

export function SpanDetailPanel({
  span,
  onNavigatePrev,
  onNavigateNext,
  hasPrevious = false,
  hasNext = false,
}: SpanDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<"details" | "scoring">("details");

  const typeUi = getSpanTypeUi(span.type ?? "other");

  return (
    <div data-testid="span-detail-panel" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Type badge */}
          <span data-testid="span-type-badge" className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${typeUi.bgColor}`} />
            <span className={`text-xs font-medium ${typeUi.color}`}>{typeUi.label}</span>
          </span>

          {/* Span name */}
          <span data-testid="span-name" className="text-sm font-semibold text-gray-200">
            {span.name}
          </span>

          {/* Span ID */}
          <span data-testid="span-id" className="font-mono text-[10px] text-gray-500">
            {truncateId(span.id)}
            <CopyButton text={span.id} />
          </span>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button
            data-testid="nav-prev"
            onClick={onNavigatePrev}
            disabled={!hasPrevious}
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous span"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            data-testid="nav-next"
            onClick={onNavigateNext}
            disabled={!hasNext}
            className="rounded-md p-1 text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next span"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-white/[0.04] px-4">
        <TabButton label="Details" testId="tab-details" active={activeTab === "details"} onClick={() => setActiveTab("details")} />
        <TabButton label="Scoring" testId="tab-scoring" active={activeTab === "scoring"} onClick={() => setActiveTab("scoring")} />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "details" && (
          <div data-testid="details-content" className="space-y-4 p-4">
            {/* Timing */}
            <div className="glass-panel rounded-xl p-4 space-y-1">
              <div className="text-[10px] uppercase tracking-[0.15em] text-gray-600 mb-2">Timing</div>
              <MetaRow label="Start" value={formatTimestamp(span.startTime)} testId="span-start-time" />
              {span.endTime != null && (
                <MetaRow label="End" value={formatTimestamp(span.endTime)} testId="span-end-time" />
              )}
              <MetaRow label="Duration" value={formatDuration(span.duration)} testId="span-duration" />
            </div>

            {/* Token usage */}
            {span.tokens && <TokenUsageBar tokens={span.tokens} />}

            {/* Metadata */}
            <div className="glass-panel rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-[0.15em] text-gray-600 mb-2">Metadata</div>
              <MetaRow label="Trace ID" value={span.traceId} testId="meta-traceId" />
              {span.tags && span.tags.length > 0 && (
                <MetaRow
                  label="Tags"
                  value={
                    <span className="flex gap-1">
                      {span.tags.map((tag) => (
                        <span key={tag} className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-gray-400">
                          {tag}
                        </span>
                      ))}
                    </span>
                  }
                  testId="meta-tags"
                />
              )}
              {span.runId && <MetaRow label="Run ID" value={span.runId} testId="meta-runId" />}
              {span.sessionId && <MetaRow label="Session ID" value={span.sessionId} testId="meta-sessionId" />}
              <MetaRow label="Status" value={span.status} testId="meta-status" />
            </div>

            {/* Code sections */}
            <CodeSection title="Input" value={span.input} testId="code-section-input" />
            <CodeSection title="Output" value={span.output} testId="code-section-output" />
            <CodeSection title="Attributes" value={span.attributes} testId="code-section-attributes" />
          </div>
        )}

        {activeTab === "scoring" && (
          <div data-testid="scoring-content" className="flex flex-col items-center justify-center gap-3 py-12">
            <p className="text-sm font-medium text-gray-400">Scoring</p>
            <p className="max-w-xs text-xs text-gray-600 text-center">
              Evaluation and scoring UI will be available in a future release.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
