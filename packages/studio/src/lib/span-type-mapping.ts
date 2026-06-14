import type { LucideIcon } from "lucide-react";
import {
  Link,
  RotateCcw,
  Layers,
  Brain,
  Wrench,
  Shield,
  Cpu,
  Circle,
} from "lucide-react";

// --- Types ---

export interface UISpan {
  id: string;
  type: string;
  name: string;
  children?: UISpan[];
}

export interface SpanTypeMapping {
  typePrefix: string;
  color: string;
  icon: LucideIcon;
  label: string;
}

// --- Constants ---

export const spanTypeMappings: SpanTypeMapping[] = [
  { typePrefix: "chain", color: "oklch(0.6 0.2 250)", icon: Link, label: "Chain" },
  { typePrefix: "turn", color: "oklch(0.6 0.2 300)", icon: RotateCcw, label: "Turn" },
  { typePrefix: "phase", color: "oklch(0.6 0.2 200)", icon: Layers, label: "Phase" },
  { typePrefix: "model", color: "oklch(0.6 0.2 170)", icon: Brain, label: "Model" },
  { typePrefix: "tool", color: "oklch(0.6 0.2 80)", icon: Wrench, label: "Tool" },
  { typePrefix: "gate", color: "oklch(0.6 0.2 340)", icon: Shield, label: "Gate" },
  { typePrefix: "processor", color: "oklch(0.6 0.2 270)", icon: Cpu, label: "Processor" },
  { typePrefix: "other", color: "oklch(0.5 0.05 0)", icon: Circle, label: "Other" },
];

export const spanTypePrefixes = [
  "chain",
  "turn",
  "phase",
  "model",
  "tool",
  "gate",
  "processor",
  "other",
] as const;

export type SpanTypePrefix = (typeof spanTypePrefixes)[number];

// --- Lookup ---

const mappingByPrefix = new Map<string, SpanTypeMapping>(
  spanTypeMappings.map((m) => [m.typePrefix, m]),
);

const otherMapping = mappingByPrefix.get("other")!;

export function getSpanTypeUi(type: string): SpanTypeMapping {
  const prefix = type.includes("_") ? type.split("_")[0] : type;
  return mappingByPrefix.get(prefix) ?? otherMapping;
}

// --- usedSpanTypes ---

export function usedSpanTypes(roots: UISpan[]): Set<string> {
  const result = new Set<string>();
  collectPrefixes(roots, result);
  return result;
}

function collectPrefixes(spans: UISpan[], acc: Set<string>): void {
  for (const span of spans) {
    const prefix = span.type.includes("_") ? span.type.split("_")[0] : span.type;
    acc.add(mappingByPrefix.has(prefix) ? prefix : "other");
    if (span.children?.length) {
      collectPrefixes(span.children, acc);
    }
  }
}
