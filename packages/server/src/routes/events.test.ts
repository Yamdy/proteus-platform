import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerEventsRoutes } from "./events.js";
import type { EventLog, StoreEvent } from "@proteus-ai/core";

function createMockEventLog(initial: StoreEvent[] = []): EventLog {
  const events = [...initial];
  return {
    appendEvent: (event: StoreEvent) => { events.push(event); },
    queryEvents: (sessionId: string, since?: number) =>
      events.filter(
        (e) => e.sessionId === sessionId && (since === undefined || e.timestamp >= since),
      ),
    queryAllEvents: (start?: number, end?: number) =>
      events.filter(
        (e) =>
          (start === undefined || e.timestamp >= start) &&
          (end === undefined || e.timestamp <= end),
      ),
  };
}

const seedEvents: StoreEvent[] = [
  { sessionId: "s1", event: "turn.start", payload: {}, timestamp: 1000 },
  { sessionId: "s1", event: "turn.end", payload: {}, timestamp: 2000 },
  { sessionId: "s2", event: "turn.start", payload: {}, timestamp: 3000 },
  { sessionId: "s2", event: "error", payload: { message: "fail" }, timestamp: 4000 },
  { sessionId: "s1", event: "checkpoint.saved", payload: {}, timestamp: 5000 },
];

describe("GET /events", () => {
  it("returns empty result when event log is empty", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog() });

    const res = await app.inject({ method: "GET", url: "/events" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.hasMore).toBe(false);

    await app.close();
  });

  it("returns all events when no filters applied", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events" });
    const body = res.json();
    expect(body.data).toHaveLength(5);
    expect(body.total).toBe(5);

    await app.close();
  });

  it("filters by sessionId", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?sessionId=s1" });
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
    for (const evt of body.data) {
      expect(evt.sessionId).toBe("s1");
    }

    await app.close();
  });

  it("filters by event type (substring match)", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?event=turn" });
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
    for (const evt of body.data) {
      expect(evt.event).toContain("turn");
    }

    await app.close();
  });

  it("filters by event type case-insensitively", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?event=ERROR" });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].event).toBe("error");

    await app.close();
  });

  it("filters by time range (since and until)", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?since=2000&until=4000" });
    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body.total).toBe(3);
    for (const evt of body.data) {
      expect(evt.timestamp).toBeGreaterThanOrEqual(2000);
      expect(evt.timestamp).toBeLessThanOrEqual(4000);
    }

    await app.close();
  });

  it("filters by since only", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?since=3000" });
    const body = res.json();
    expect(body.data).toHaveLength(3);

    await app.close();
  });

  it("filters by until only", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?until=2000" });
    const body = res.json();
    expect(body.data).toHaveLength(2);

    await app.close();
  });

  it("paginates results correctly", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    // Page 1, limit 2
    const res1 = await app.inject({ method: "GET", url: "/events?limit=2&page=1" });
    const body1 = res1.json();
    expect(body1.data).toHaveLength(2);
    expect(body1.total).toBe(5);
    expect(body1.page).toBe(1);
    expect(body1.limit).toBe(2);
    expect(body1.hasMore).toBe(true);

    // Page 2, limit 2
    const res2 = await app.inject({ method: "GET", url: "/events?limit=2&page=2" });
    const body2 = res2.json();
    expect(body2.data).toHaveLength(2);
    expect(body2.hasMore).toBe(true);

    // Page 3, limit 2 (last page)
    const res3 = await app.inject({ method: "GET", url: "/events?limit=2&page=3" });
    const body3 = res3.json();
    expect(body3.data).toHaveLength(1);
    expect(body3.hasMore).toBe(false);

    await app.close();
  });

  it("clamps limit to max 200", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?limit=999" });
    const body = res.json();
    expect(body.limit).toBe(200);

    await app.close();
  });

  it("clamps limit to min 1", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?limit=0" });
    const body = res.json();
    expect(body.limit).toBe(1);

    await app.close();
  });

  it("defaults page to 1 when invalid", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({ method: "GET", url: "/events?page=-5" });
    const body = res.json();
    expect(body.page).toBe(1);

    await app.close();
  });

  it("returns empty result when no eventLog provided", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, {});

    const res = await app.inject({ method: "GET", url: "/events" });
    const body = res.json();
    expect(body.data).toEqual([]);
    expect(body.total).toBe(0);

    await app.close();
  });

  it("combines all filters together", async () => {
    const app = Fastify();
    await registerEventsRoutes(app, { eventLog: createMockEventLog(seedEvents) });

    const res = await app.inject({
      method: "GET",
      url: "/events?sessionId=s1&event=turn&since=1000&until=3000&limit=1&page=1",
    });
    const body = res.json();
    // s1 + "turn" substring + timestamp 1000..3000: turn.start(1000), turn.end(2000)
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(2);
    expect(body.hasMore).toBe(true);
    expect(body.data[0].event).toBe("turn.start");

    await app.close();
  });
});
