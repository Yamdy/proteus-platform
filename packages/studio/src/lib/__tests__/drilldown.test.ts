import { describe, it, expect } from "vitest";
import { buildTracesDrilldownUrl, narrowWindowToBucket } from "../drilldown.js";

describe("buildTracesDrilldownUrl", () => {
  it("builds URL with default base and traces tab", () => {
    const url = buildTracesDrilldownUrl({
      filters: {},
    });
    expect(url).toBe("/observability?tab=traces");
  });

  it("includes scope overrides as query params", () => {
    const url = buildTracesDrilldownUrl({
      filters: {},
      scope: { entityType: "tool", entityName: "web_search" },
    });
    expect(url).toContain("tab=traces");
    expect(url).toContain("entityType=tool");
    expect(url).toContain("entityName=web_search");
  });

  it("includes timestamp range when provided", () => {
    const url = buildTracesDrilldownUrl({
      filters: {},
      timestamp: { start: 1000, end: 2000 },
    });
    expect(url).toContain("start=1000");
    expect(url).toContain("end=2000");
  });

  it("includes base filters in URL", () => {
    const url = buildTracesDrilldownUrl({
      filters: { sessionId: "sess-1", status: "error" },
    });
    expect(url).toContain("sessionId=sess-1");
    expect(url).toContain("status=error");
  });

  it("scope overrides take precedence over base filters", () => {
    const url = buildTracesDrilldownUrl({
      filters: { status: "ok" },
      scope: { status: "error" },
    });
    // scope status=error should override base status=ok
    expect(url).toContain("status=error");
    expect(url).not.toMatch(/status=ok/);
  });

  it("uses custom baseUrl when provided", () => {
    const url = buildTracesDrilldownUrl({
      baseUrl: "https://example.com/dashboard",
      filters: {},
    });
    expect(url).toMatch(/^https:\/\/example\.com\/dashboard\?/);
    expect(url).toContain("tab=traces");
  });
});

describe("narrowWindowToBucket", () => {
  it("computes 1h bucket by flooring to the hour", () => {
    // 2024-01-15T14:37:00.000Z
    const ts = new Date("2024-01-15T14:37:00.000Z").getTime();
    const result = narrowWindowToBucket({ timestamp: ts, interval: "1h" });

    expect(result.start).toBe(new Date("2024-01-15T14:00:00.000Z").getTime());
    expect(result.end).toBe(new Date("2024-01-15T15:00:00.000Z").getTime());
  });

  it("computes 6h bucket by flooring to 6h block", () => {
    // 2024-01-15T14:37:00.000Z — should floor to 12:00
    const ts = new Date("2024-01-15T14:37:00.000Z").getTime();
    const result = narrowWindowToBucket({ timestamp: ts, interval: "6h" });

    expect(result.start).toBe(new Date("2024-01-15T12:00:00.000Z").getTime());
    expect(result.end).toBe(new Date("2024-01-15T18:00:00.000Z").getTime());
  });

  it("computes 1d bucket by flooring to UTC midnight", () => {
    // 2024-01-15T14:37:00.000Z
    const ts = new Date("2024-01-15T14:37:00.000Z").getTime();
    const result = narrowWindowToBucket({ timestamp: ts, interval: "1d" });

    expect(result.start).toBe(new Date("2024-01-15T00:00:00.000Z").getTime());
    expect(result.end).toBe(new Date("2024-01-16T00:00:00.000Z").getTime());
  });

  it("handles 1h bucket at exact hour boundary", () => {
    const ts = new Date("2024-01-15T14:00:00.000Z").getTime();
    const result = narrowWindowToBucket({ timestamp: ts, interval: "1h" });

    expect(result.start).toBe(ts);
    expect(result.end).toBe(new Date("2024-01-15T15:00:00.000Z").getTime());
  });

  it("handles 6h bucket in first block of day (00:00-06:00)", () => {
    const ts = new Date("2024-01-15T03:00:00.000Z").getTime();
    const result = narrowWindowToBucket({ timestamp: ts, interval: "6h" });

    expect(result.start).toBe(new Date("2024-01-15T00:00:00.000Z").getTime());
    expect(result.end).toBe(new Date("2024-01-15T06:00:00.000Z").getTime());
  });
});
