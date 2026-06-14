import { useMemo } from "react";
import {
  buildTracesDrilldownUrl,
  narrowWindowToBucket,
} from "../lib/drilldown.js";
import type { MetricsDimensionalFilter } from "../lib/drilldown.js";

/**
 * Hook that provides drilldown href builders from the current metrics filters.
 */
export function useDrilldown(filters: MetricsDimensionalFilter) {
  return useMemo(
    () => ({
      getTracesHref: (scope?: {
        entityType?: string;
        entityName?: string;
        status?: string;
      }) => buildTracesDrilldownUrl({ filters, scope }),

      getLogsHref: (scope?: {
        entityType?: string;
        entityName?: string;
        status?: string;
      }) =>
        buildTracesDrilldownUrl({
          filters,
          scope,
          baseUrl: "/observability",
        }).replace("tab=traces", "tab=logs"),

      getBucketTracesHref: (timestamp: number, interval: "1h" | "6h" | "1d") =>
        buildTracesDrilldownUrl({
          filters,
          timestamp: narrowWindowToBucket({ timestamp, interval }),
        }),
    }),
    [filters],
  );
}
