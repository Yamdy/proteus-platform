/**
 * Maps span names / types to UI metadata.
 *
 * Delegates to the canonical span-type-mapping module and adapts the
 * return shape for consumers that expect { dotClass, label }.
 */

import { getSpanTypeUi as _getSpanTypeUi } from "./span-type-mapping";

export interface SpanTypeUi {
  /** Tailwind background-color class for the type dot */
  dotClass: string;
  /** Human-readable label (falls back to the span name itself) */
  label: string;
}

// Map oklch colors to the closest Tailwind class used by legacy consumers.
const COLOR_TO_TAILWIND: Record<string, string> = {
  "oklch(0.6 0.2 250)": "bg-pink-400",    // chain
  "oklch(0.6 0.2 300)": "bg-emerald-400",  // turn
  "oklch(0.6 0.2 200)": "bg-indigo-400",   // phase
  "oklch(0.6 0.2 170)": "bg-purple-400",   // model
  "oklch(0.6 0.2 80)":  "bg-teal-400",     // tool
  "oklch(0.6 0.2 340)": "bg-rose-400",     // gate
  "oklch(0.6 0.2 270)": "bg-violet-400",   // processor
  "oklch(0.5 0.05 0)":  "bg-gray-500",     // other
};

const DEFAULT_UI: SpanTypeUi = {
  dotClass: "bg-gray-500",
  label: "Span",
};

/**
 * Return UI metadata for a span name.
 *
 * Extracts the prefix (before "_" or ".") and looks it up via the
 * canonical mapping, then adapts to the legacy { dotClass, label } shape.
 */
export function getSpanTypeUi(spanName: string): SpanTypeUi {
  const mapping = _getSpanTypeUi(spanName);
  if (!mapping) return DEFAULT_UI;
  return {
    dotClass: COLOR_TO_TAILWIND[mapping.color] ?? "bg-gray-500",
    label: mapping.label,
  };
}
