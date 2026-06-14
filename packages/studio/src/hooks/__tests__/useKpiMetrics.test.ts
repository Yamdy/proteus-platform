import { describe, it, expect } from "vitest";
import {
  formatCompact,
  computeErrorRate,
  mergeTokenValues,
  buildAggregateBody,
} from "../kpi-helpers.js";

// ---------------------------------------------------------------------------
// formatCompact
// ---------------------------------------------------------------------------
describe("formatCompact", () => {
  it("returns raw number below 1 000", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(42)).toBe("42");
    expect(formatCompact(999)).toBe("999");
  });

  it("formats thousands with K suffix", () => {
    expect(formatCompact(1_000)).toBe("1.0K");
    expect(formatCompact(1_500)).toBe("1.5K");
    expect(formatCompact(99_000)).toBe("99.0K");
  });

  it("formats millions with M suffix", () => {
    expect(formatCompact(1_000_000)).toBe("1.0M");
    expect(formatCompact(2_500_000)).toBe("2.5M");
  });

  it("formats billions with B suffix", () => {
    expect(formatCompact(1_000_000_000)).toBe("1.0B");
  });

  it("handles negative numbers", () => {
    expect(formatCompact(-500)).toBe("-500");
    expect(formatCompact(-1_500)).toBe("-1.5K");
  });

  it("handles decimals", () => {
    expect(formatCompact(0.5)).toBe("0.5");
    expect(formatCompact(0)).toBe("0");
  });
});

// ---------------------------------------------------------------------------
// computeErrorRate
// ---------------------------------------------------------------------------
describe("computeErrorRate", () => {
  it("returns 0 when denominator is 0", () => {
    expect(computeErrorRate(0, 0)).toBe(0);
    expect(computeErrorRate(5, 0)).toBe(0);
  });

  it("returns correct percentage", () => {
    expect(computeErrorRate(1, 10)).toBe(10);
    expect(computeErrorRate(0, 10)).toBe(0);
    expect(computeErrorRate(10, 10)).toBe(100);
    expect(computeErrorRate(3, 7)).toBeCloseTo(42.86, 1);
  });
});

// ---------------------------------------------------------------------------
// mergeTokenValues
// ---------------------------------------------------------------------------
describe("mergeTokenValues", () => {
  it("sums input and output values", () => {
    expect(mergeTokenValues(100, 200)).toBe(300);
    expect(mergeTokenValues(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildAggregateBody
// ---------------------------------------------------------------------------
describe("buildAggregateBody", () => {
  it("builds body with metric name and comparePeriod", () => {
    const body = buildAggregateBody("agent_runs", undefined);
    expect(body).toHaveProperty("metric", "agent_runs");
    expect(body).toHaveProperty("comparePeriod", "previous_period");
  });

  it("includes filters when provided", () => {
    const filters = { sessionId: "sess-1", since: 1000 };
    const body = buildAggregateBody("total_tokens", filters);
    expect(body).toHaveProperty("metric", "total_tokens");
    expect(body).toHaveProperty("filters", filters);
  });

  it("omits filters when undefined", () => {
    const body = buildAggregateBody("model_cost", undefined);
    expect(body).not.toHaveProperty("filters");
  });
});
