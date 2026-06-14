/**
 * Pure utility functions for metrics filtering.
 * No React dependencies — can be tested and used independently.
 */

// --- Types ---

export type MetricsPreset = "24h" | "3d" | "7d" | "14d" | "30d" | "custom";

export interface MetricsDimensionalFilter {
  entityType?: string;
  entityName?: string;
  sessionId?: string;
  tags?: string[];
}

export interface TimeWindow {
  start: number;
  end: number;
}

// --- Preset duration mapping ---

export const PRESET_DURATION_MS: Record<Exclude<MetricsPreset, "custom">, number> = {
  "24h": 86_400_000,
  "3d": 259_200_000,
  "7d": 604_800_000,
  "14d": 1_209_600_000,
  "30d": 2_592_000_000,
};

// --- Filter token mapping ---

const KNOWN_FILTER_KEYS = new Set(["entityType", "entityName", "sessionId", "tags"]);

/**
 * Maps URL search-param tokens to a MetricsDimensionalFilter.
 * Only known keys are mapped; unknown keys are silently ignored.
 */
export function buildMetricsDimensionalFilter(
  tokens: Record<string, string | string[]>,
): MetricsDimensionalFilter {
  const filter: MetricsDimensionalFilter = {};

  for (const key of KNOWN_FILTER_KEYS) {
    const value = tokens[key];
    if (value === undefined) continue;

    if (key === "tags") {
      filter.tags = Array.isArray(value) ? value : [value];
    } else if (key === "entityType" || key === "entityName" || key === "sessionId") {
      if (typeof value === "string") {
        filter[key] = value;
      }
    }
  }

  return filter;
}

// --- Time window computation ---

/**
 * Computes an anchored time window for a given preset.
 * For non-custom presets, anchor defaults to Date.now().
 * For custom presets, from/to must be supplied.
 */
export function computeAnchoredWindow(
  preset: MetricsPreset,
  anchor?: number,
  customRange?: { from: number; to: number },
): TimeWindow {
  if (preset === "custom") {
    if (customRange) {
      return { start: customRange.from, end: customRange.to };
    }
    return { start: 0, end: 0 };
  }

  const duration = PRESET_DURATION_MS[preset];
  const end = anchor ?? Date.now();
  return { start: end - duration, end };
}

// --- Filter key ---

/**
 * Produces a stable, deterministic JSON key for a given window + filter combination.
 * Object keys are sorted to ensure deterministic output regardless of insertion order.
 */
export function computeFilterKey(
  window: TimeWindow,
  filter: MetricsDimensionalFilter,
): string {
  const combined: Record<string, unknown> = { window, ...filter };
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(combined).sort()) {
    sorted[key] = combined[key];
  }
  return JSON.stringify(sorted);
}
