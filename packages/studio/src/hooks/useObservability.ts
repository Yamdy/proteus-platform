import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/api";
import { useConnectionStore } from "../stores/connectionStore";

const API_BASE_TRACES = "/api/traces";
const API_BASE_METRICS = "/api/metrics";
const API_BASE_COSTS = "/api/costs";
const WS_URL = "/ws";

// --- Types ---

export type PhaseName =
  | "context_assembly"
  | "llm_inference"
  | "action_resolution"
  | "tool_execution"
  | "result_observation";

export interface PhaseEvent {
  phase: PhaseName;
  status: "started" | "completed" | "error";
  timestamp: number;
  duration?: number;
  traceId: string;
  sessionId?: string;
  turnId?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error" | "unset";
  attributes?: Record<string, unknown>;
  events?: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;
}

export interface Trace {
  traceId: string;
  sessionId: string;
  turnId?: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error" | "unset";
  spans: TraceSpan[];
}

export interface ToolCallMetric {
  id: string;
  traceId: string;
  toolName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error";
  parameters?: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export interface CostEntry {
  id: string;
  sessionId: string;
  turnId?: string;
  timestamp: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface CostSummary {
  totalCostUsd: number;
  totalTokens: number;
  bySession: Array<{
    sessionId: string;
    costUsd: number;
    tokens: number;
  }>;
  byModel: Array<{
    model: string;
    costUsd: number;
    tokens: number;
  }>;
  byTurn: CostEntry[];
}

export interface MetricsSnapshot {
  totalTraces: number;
  totalSpans: number;
  averageLatencyMs: number;
  errorRate: number;
  phaseBreakdown: Record<PhaseName, { count: number; avgDurationMs: number }>;
  toolCallStats: Array<{
    toolName: string;
    count: number;
    avgDurationMs: number;
    errorRate: number;
  }>;
}

// --- Hook ---

interface UseObservabilityReturn {
  traces: Trace[];
  metrics: MetricsSnapshot | null;
  costs: CostSummary | null;
  toolCalls: ToolCallMetric[];
  phaseEvents: PhaseEvent[];
  loading: boolean;
  loadingTraces: boolean;
  loadingMetrics: boolean;
  loadingCosts: boolean;
  error: string | null;
  wsConnected: boolean;
  fetchTraces: (params?: { sessionId?: string; limit?: number }) => Promise<void>;
  fetchMetrics: () => Promise<void>;
  fetchCosts: (params?: { sessionId?: string }) => Promise<void>;
  fetchToolCalls: (traceId: string) => Promise<void>;
  subscribeToEvents: () => void;
  unsubscribeFromEvents: () => void;
  clearPhaseEvents: () => void;
}

export function useObservability(): UseObservabilityReturn {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [costs, setCosts] = useState<CostSummary | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallMetric[]>([]);
  const [phaseEvents, setPhaseEvents] = useState<PhaseEvent[]>([]);
  const [loadingTraces, setLoadingTraces] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const loading = loadingTraces || loadingMetrics || loadingCosts;

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- REST fetchers ---

  const fetchTraces = useCallback(
    async (params?: { sessionId?: string; limit?: number }) => {
      setLoadingTraces(true);
      setError(null);
      try {
        // Server route is GET /api/traces/:sessionId
        const sessionId = params?.sessionId ?? "default";
        const url = new URL(`${API_BASE_TRACES}/${sessionId}`, window.location.origin);
        if (params?.limit) url.searchParams.set("limit", String(params.limit));

        const res = await fetch(url.toString());
        if (res.status === 404) {
          setTraces([]);
          return;
        }
        if (!res.ok) throw new Error(`Failed to fetch traces: ${res.status}`);
        const payload = await res.json();
        // Server returns { sessionId, events, count } — normalize to Trace[]
        const data: Trace[] = payload.events ?? payload;
        setTraces(data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
      } finally {
        setLoadingTraces(false);
      }
    },
    [],
  );

  const fetchMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    setError(null);
    try {
      const data = await apiFetch<MetricsSnapshot>(API_BASE_METRICS);
      setMetrics(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  const fetchCosts = useCallback(async (params?: { sessionId?: string }) => {
    setLoadingCosts(true);
    setError(null);
    try {
      // Server route: GET /api/costs or GET /api/costs/:sessionId
      const url = params?.sessionId
        ? `${API_BASE_COSTS}/${params.sessionId}`
        : API_BASE_COSTS;

      const data = await apiFetch<CostSummary>(url);
      setCosts(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoadingCosts(false);
    }
  }, []);

  const fetchToolCalls = useCallback(async (traceId: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_BASE_TRACES}/${traceId}/tool-calls`);
      if (res.status === 404) {
        // Endpoint not available on this server
        setToolCalls([]);
        return;
      }
      if (!res.ok) throw new Error(`Failed to fetch tool calls: ${res.status}`);
      const data: ToolCallMetric[] = await res.json();
      setToolCalls(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    }
  }, []);

  // --- WebSocket subscription ---

  const subscribeToEvents = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsBase = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(`${wsBase}${WS_URL}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      useConnectionStore.getState().connect();
      // Subscribe to phase events
      ws.send(JSON.stringify({ type: "subscribe", channels: ["phase", "self_modify"] }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "phase") {
          const phaseEvent: PhaseEvent = msg.data;
          setPhaseEvents((prev) => [phaseEvent, ...prev].slice(0, 200));
        }

        if (msg.type === "self_modify") {
          // Trigger history refresh on self-modify events
          // The component can listen to this via useEffect
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      useConnectionStore.getState().disconnect();
      wsRef.current = null;
      // Auto-reconnect after 3 seconds
      reconnectTimerRef.current = setTimeout(() => {
        subscribeToEvents();
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const unsubscribeFromEvents = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    useConnectionStore.getState().disconnect();
  }, []);

  const clearPhaseEvents = useCallback(() => {
    setPhaseEvents([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribeFromEvents();
    };
  }, [unsubscribeFromEvents]);

  return {
    traces,
    metrics,
    costs,
    toolCalls,
    phaseEvents,
    loading,
    loadingTraces,
    loadingMetrics,
    loadingCosts,
    error,
    wsConnected,
    fetchTraces,
    fetchMetrics,
    fetchCosts,
    fetchToolCalls,
    subscribeToEvents,
    unsubscribeFromEvents,
    clearPhaseEvents,
  };
}
