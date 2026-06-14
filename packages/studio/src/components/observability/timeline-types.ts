/**
 * Span type definitions and UI mappings for the TraceTimeline component.
 *
 * Delegates to the canonical span-type-mapping module.
 * Keeps deriveSpanType for name-based prefix extraction.
 */

import {
  getSpanTypeUi,
  spanTypePrefixes,
  usedSpanTypes,
  type SpanTypePrefix,
  type SpanTypeMapping,
} from "../../lib/span-type-mapping";

// Re-export everything for backward compatibility
export { getSpanTypeUi, spanTypePrefixes, usedSpanTypes, type SpanTypePrefix, type SpanTypeMapping };

/** Backward-compatible alias — prefer SpanTypePrefix in new code. */
export type SpanType = SpanTypePrefix;

/** Backward-compatible alias — prefer SpanTypeMapping in new code. */
export type SpanTypeUi = SpanTypeMapping;

/**
 * Derive the span type prefix from a span name.
 * Matches known prefixes; falls back to "other".
 */
export function deriveSpanType(name: string): SpanTypePrefix {
  const lower = name.toLowerCase();
  for (const prefix of spanTypePrefixes) {
    if (prefix === "other") continue;
    if (lower.startsWith(prefix)) return prefix;
  }
  // Handle legacy aliases that don't match canonical prefixes
  if (lower.startsWith("llm") || lower.startsWith("openai") || lower.startsWith("anthropic")) return "model";
  if (lower.startsWith("agent")) return "chain";
  if (lower.startsWith("context") || lower.startsWith("prompt")) return "phase";
  if (lower.startsWith("handler")) return "processor";
  return "other";
}
