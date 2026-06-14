import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDrilldown } from "../useDrilldown.js";

describe("useDrilldown", () => {
  const baseFilters = { sessionId: "sess-1", model: "gpt-4" };

  it("getTracesHref returns URL with base filters", () => {
    const { result } = renderHook(() => useDrilldown(baseFilters));
    const href = result.current.getTracesHref();

    expect(href).toContain("tab=traces");
    expect(href).toContain("sessionId=sess-1");
    expect(href).toContain("model=gpt-4");
  });

  it("getTracesHref merges scope overrides", () => {
    const { result } = renderHook(() => useDrilldown(baseFilters));
    const href = result.current.getTracesHref({ status: "error" });

    expect(href).toContain("status=error");
    expect(href).toContain("sessionId=sess-1");
  });

  it("getBucketTracesHref narrows window for 1h interval", () => {
    const { result } = renderHook(() => useDrilldown(baseFilters));
    const ts = new Date("2024-01-15T14:37:00.000Z").getTime();
    const href = result.current.getBucketTracesHref(ts, "1h");

    expect(href).toContain("tab=traces");
    expect(href).toContain(`start=${new Date("2024-01-15T14:00:00.000Z").getTime()}`);
    expect(href).toContain(`end=${new Date("2024-01-15T15:00:00.000Z").getTime()}`);
  });

  it("getLogsHref returns URL with logs tab", () => {
    const { result } = renderHook(() => useDrilldown(baseFilters));
    const href = result.current.getLogsHref();

    expect(href).toContain("tab=logs");
    expect(href).toContain("sessionId=sess-1");
  });
});
