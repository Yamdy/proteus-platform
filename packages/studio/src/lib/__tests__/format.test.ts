import { describe, it, expect } from "vitest";
import { formatCompact, formatCost } from "../format";

describe("formatCompact", () => {
  it("returns '0' for zero", () => {
    expect(formatCompact(0)).toBe("0");
  });

  it("returns exact number for values below 1000", () => {
    expect(formatCompact(1)).toBe("1");
    expect(formatCompact(42)).toBe("42");
    expect(formatCompact(999)).toBe("999");
  });

  it("formats 1000 as '1.0K'", () => {
    expect(formatCompact(1000)).toBe("1.0K");
  });

  it("formats 1234 as '1.2K'", () => {
    expect(formatCompact(1234)).toBe("1.2K");
  });

  it("formats 10000 as '10.0K'", () => {
    expect(formatCompact(10000)).toBe("10.0K");
  });

  it("formats 999999 as '1000.0K'", () => {
    expect(formatCompact(999999)).toBe("1000.0K");
  });

  it("formats 1000000 as '1.0M'", () => {
    expect(formatCompact(1000000)).toBe("1.0M");
  });

  it("formats 1234567 as '1.2M'", () => {
    expect(formatCompact(1234567)).toBe("1.2M");
  });

  it("formats negative numbers with K suffix", () => {
    expect(formatCompact(-1500)).toBe("-1.5K");
  });
});

describe("formatCost", () => {
  it("formats zero as '$0.00'", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats 0.02 as '$0.02'", () => {
    expect(formatCost(0.02)).toBe("$0.02");
  });

  it("formats 1.5 as '$1.50'", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("formats 1234.56 as '$1,234.56'", () => {
    expect(formatCost(1234.56)).toBe("$1,234.56");
  });

  it("formats small fractional values", () => {
    expect(formatCost(0.001)).toBe("$0.00");
    expect(formatCost(0.005)).toBe("$0.01");
  });

  it("formats large values with commas", () => {
    expect(formatCost(1000000)).toBe("$1,000,000.00");
  });
});
