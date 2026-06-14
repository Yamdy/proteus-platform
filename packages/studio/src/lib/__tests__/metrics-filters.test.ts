import { describe, it, expect } from "vitest";
import {
  buildMetricsDimensionalFilter,
  PRESET_DURATION_MS,
  computeAnchoredWindow,
  computeFilterKey,
} from "../metrics-filters";
import type { MetricsDimensionalFilter } from "../metrics-filters";

describe("buildMetricsDimensionalFilter", () => {
  it("returns empty filter when no tokens provided", () => {
    const result = buildMetricsDimensionalFilter({});
    expect(result).toEqual({});
  });

  it("maps entityType token to filter", () => {
    const result = buildMetricsDimensionalFilter({ entityType: "tool" });
    expect(result).toEqual({ entityType: "tool" });
  });

  it("maps entityName token to filter", () => {
    const result = buildMetricsDimensionalFilter({ entityName: "search-agent" });
    expect(result).toEqual({ entityName: "search-agent" });
  });

  it("maps sessionId token to filter", () => {
    const result = buildMetricsDimensionalFilter({ sessionId: "sess-123" });
    expect(result).toEqual({ sessionId: "sess-123" });
  });

  it("maps tags token (string) to single-element array", () => {
    const result = buildMetricsDimensionalFilter({ tags: "production" });
    expect(result).toEqual({ tags: ["production"] });
  });

  it("maps tags token (array) to array", () => {
    const result = buildMetricsDimensionalFilter({ tags: ["prod", "v2"] });
    expect(result).toEqual({ tags: ["prod", "v2"] });
  });

  it("ignores unknown token keys", () => {
    const result = buildMetricsDimensionalFilter({
      entityType: "tool",
      unknownKey: "value",
    });
    expect(result).toEqual({ entityType: "tool" });
  });

  it("combines multiple known tokens", () => {
    const result = buildMetricsDimensionalFilter({
      entityType: "tool",
      entityName: "search",
      sessionId: "sess-1",
      tags: ["prod"],
    });
    expect(result).toEqual({
      entityType: "tool",
      entityName: "search",
      sessionId: "sess-1",
      tags: ["prod"],
    });
  });
});

describe("PRESET_DURATION_MS", () => {
  it("maps 24h to 86400000 ms", () => {
    expect(PRESET_DURATION_MS["24h"]).toBe(86_400_000);
  });

  it("maps 3d to 259200000 ms", () => {
    expect(PRESET_DURATION_MS["3d"]).toBe(259_200_000);
  });

  it("maps 7d to 604800000 ms", () => {
    expect(PRESET_DURATION_MS["7d"]).toBe(604_800_000);
  });

  it("maps 14d to 1209600000 ms", () => {
    expect(PRESET_DURATION_MS["14d"]).toBe(1_209_600_000);
  });

  it("maps 30d to 2592000000 ms", () => {
    expect(PRESET_DURATION_MS["30d"]).toBe(2_592_000_000);
  });
});

describe("computeAnchoredWindow", () => {
  it("computes start and end from anchor for 24h preset", () => {
    const anchor = 1_700_000_000_000;
    const result = computeAnchoredWindow("24h", anchor);
    expect(result).toEqual({
      start: anchor - 86_400_000,
      end: anchor,
    });
  });

  it("computes start and end from anchor for 7d preset", () => {
    const anchor = 1_700_000_000_000;
    const result = computeAnchoredWindow("7d", anchor);
    expect(result).toEqual({
      start: anchor - 604_800_000,
      end: anchor,
    });
  });

  it("uses provided from/to for custom preset", () => {
    const result = computeAnchoredWindow("custom", undefined, {
      from: 1_000_000_000_000,
      to: 1_000_100_000_000,
    });
    expect(result).toEqual({
      start: 1_000_000_000_000,
      end: 1_000_100_000_000,
    });
  });

  it("returns zeros for custom preset without from/to", () => {
    const result = computeAnchoredWindow("custom");
    expect(result).toEqual({ start: 0, end: 0 });
  });
});

describe("computeFilterKey", () => {
  it("produces stable JSON string for same inputs", () => {
    const window = { start: 100, end: 200 };
    const filter: MetricsDimensionalFilter = { entityType: "tool" };
    const key1 = computeFilterKey(window, filter);
    const key2 = computeFilterKey(window, filter);
    expect(key1).toBe(key2);
  });

  it("changes when window changes", () => {
    const filter: MetricsDimensionalFilter = {};
    const key1 = computeFilterKey({ start: 100, end: 200 }, filter);
    const key2 = computeFilterKey({ start: 100, end: 300 }, filter);
    expect(key1).not.toBe(key2);
  });

  it("changes when filter changes", () => {
    const window = { start: 100, end: 200 };
    const key1 = computeFilterKey(window, {});
    const key2 = computeFilterKey(window, { entityType: "tool" });
    expect(key1).not.toBe(key2);
  });

  it("is deterministic regardless of key insertion order", () => {
    const window = { start: 100, end: 200 };
    const filterA: MetricsDimensionalFilter = { entityType: "tool", sessionId: "s1" };
    const filterB: MetricsDimensionalFilter = { sessionId: "s1", entityType: "tool" };
    const key1 = computeFilterKey(window, filterA);
    const key2 = computeFilterKey(window, filterB);
    expect(key1).toBe(key2);
  });
});
