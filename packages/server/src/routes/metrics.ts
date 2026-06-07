// @proteus-ai/server — Metrics / Costs / Traces routes

import type { FastifyInstance } from "fastify";
import type { MetricsCollector, CostStore, EventLog, SessionStore } from "@proteus-ai/core";

export interface MetricsRoutesOptions {
  metrics?: MetricsCollector;
  costStore?: CostStore;
  eventLog?: EventLog;
  sessionStore?: SessionStore;
  handlerCount?: number;
}

export async function registerMetricsRoutes(app: FastifyInstance, opts: MetricsRoutesOptions): Promise<void> {
  const { metrics, costStore, eventLog, sessionStore } = opts;

  app.get("/metrics", async () => {
    const s = metrics?.getMetrics();
    return { totalTraces: s?.turnCount ?? 0, averageLatencyMs: s?.lastTurnDuration ?? 0, errorRate: s?.consecutiveErrors ?? 0 };
  });

  app.get("/costs", async () => {
    let records: Array<{ sessionId: string; turnId: string; promptTokens: number; completionTokens: number; timestamp: number }> = [];
    if (costStore && sessionStore) records = sessionStore.listSessions().flatMap((s) => costStore.loadCostRecords(s.sessionId));
    return { totalTokens: records.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0), byTurn: records };
  });

  app.get<{ Params: { sessionId: string } }>("/costs/:sessionId", async (request) => {
    return costStore ? costStore.loadCostRecords(request.params.sessionId) : [];
  });

  app.get<{ Params: { sessionId: string }; Querystring: { since?: string } }>(
    "/traces/:sessionId", async (request) => {
      const since = request.query.since ? Number(request.query.since) : undefined;
      const events = eventLog ? eventLog.queryEvents(request.params.sessionId, since) : [];
      return { sessionId: request.params.sessionId, events, count: events.length };
    },
  );

  app.get<{ Querystring: { page?: string; limit?: string; since?: string } }>(
    "/traces", async (request) => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 25));
      const allEvents = eventLog ? eventLog.queryAllEvents(request.query.since ? Number(request.query.since) : undefined) : [];
      const traceMap = new Map<string, { startTime: number; endTime?: number; events: typeof allEvents }>();
      for (const event of allEvents) {
        const traceId = event.sessionId || "unknown";
        const existing = traceMap.get(traceId) ?? { startTime: event.timestamp, events: [] };
        existing.events.push(event);
        if (event.timestamp < existing.startTime) existing.startTime = event.timestamp;
        if (!existing.endTime || event.timestamp > existing.endTime) existing.endTime = event.timestamp;
        traceMap.set(traceId, existing);
      }
      const traces = Array.from(traceMap.entries()).map(([traceId, data]) => ({
        traceId, name: data.events[0]?.event || "unknown", status: data.events.some((e) => e.event === "error") ? "error" as const : "success" as const,
        startTime: data.startTime, latency: data.endTime ? data.endTime - data.startTime : undefined,
      }));
      traces.sort((a, b) => b.startTime - a.startTime);
      const start = (page - 1) * limit;
      return { data: traces.slice(start, start + limit), total: traces.length, page, limit, hasMore: start + limit < traces.length };
    },
  );
}
