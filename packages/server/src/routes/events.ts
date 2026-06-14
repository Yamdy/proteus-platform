// @proteus-ai/server — Event log query routes

import type { FastifyInstance } from "fastify";
import type { EventLog, StoreEvent } from "@proteus-ai/core";

export interface EventsRouteOptions {
  eventLog?: EventLog;
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  opts: EventsRouteOptions,
): Promise<void> {
  const { eventLog } = opts;

  // GET /events — query event log with filters
  app.get<{
    Querystring: {
      sessionId?: string;
      event?: string;
      since?: string;
      until?: string;
      limit?: string;
      page?: string;
    };
  }>("/events", async (request) => {
    const since = request.query.since ? Number(request.query.since) : undefined;
    const until = request.query.until ? Number(request.query.until) : undefined;
    const rawPage = request.query.page !== undefined ? Number(request.query.page) : NaN;
    const rawLimit = request.query.limit !== undefined ? Number(request.query.limit) : NaN;
    const page = Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1);
    const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50));

    // 1. Get all events within the time range
    const allEvents: StoreEvent[] = eventLog
      ? eventLog.queryAllEvents(since, until)
      : [];

    // 2. Filter by sessionId if provided
    let filtered = allEvents;
    if (request.query.sessionId) {
      filtered = filtered.filter(
        (e) => e.sessionId === request.query.sessionId,
      );
    }

    // 3. Filter by event type (substring match) if provided
    if (request.query.event) {
      const needle = request.query.event.toLowerCase();
      filtered = filtered.filter((e) =>
        e.event.toLowerCase().includes(needle),
      );
    }

    // 4. Paginate
    const total = filtered.length;
    const start = (page - 1) * limit;
    const data = filtered.slice(start, start + limit);

    return {
      data,
      total,
      page,
      limit,
      hasMore: start + limit < total,
    };
  });
}
