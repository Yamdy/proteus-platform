import type { EventLog } from "./checkpoint-store.js";

// --- Types ---

export type AttributionCategory = "E" | "T" | "C" | "L" | "O" | "V" | "G";

export interface AttributionRecord {
  category: AttributionCategory;
  phase: string;
  error: string;
  timestamp: number;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface AttributionFilter {
  category?: AttributionCategory;
  sessionId?: string;
  since?: number;
}

export interface AttributionStore {
  save(record: AttributionRecord): void;
  query(filter?: AttributionFilter): AttributionRecord[];
}

// --- ETCLOVG Layer constants ---

export const ETCLOVGLayer = {
  E: "E", // Execution environment
  T: "T", // Tool execution
  C: "C", // Context assembly
  L: "L", // LLM inference / Lifecycle
  O: "O", // Observability
  V: "V", // Validation
  G: "G", // Governance
} as const;

// --- Phase-to-category mapping ---

const PHASE_TO_CATEGORY: Record<string, AttributionCategory> = {
  context_assembly: "C",
  llm_inference: "L",
  tool_execution: "T",
  action_resolution: "T",
  result_observation: "O",
  governance: "G",
  handler: "E",
};

// --- attributeFailure ---

export interface AttributeFailureInput {
  phase: string;
  error: Error;
  trust?: number;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export function attributeFailure(input: AttributeFailureInput): AttributionRecord {
  const { phase, error, trust, sessionId, metadata } = input;

  let category: AttributionCategory;

  if (phase === "handler" && trust !== undefined) {
    category = "E";
  } else {
    category = PHASE_TO_CATEGORY[phase] ?? "O";
  }

  return {
    category,
    phase,
    error: error.message,
    timestamp: Date.now(),
    sessionId,
    metadata,
  };
}

// --- InMemoryAttributionStore ---

export class InMemoryAttributionStore implements AttributionStore {
  private records: AttributionRecord[] = [];
  private readonly eventLog?: EventLog;

  constructor(eventLog?: EventLog) {
    this.eventLog = eventLog;
  }

  save(record: AttributionRecord): void {
    this.records.push(record);

    // Persist to EventLog if available
    if (this.eventLog && record.sessionId) {
      this.eventLog.appendEvent({
        sessionId: record.sessionId,
        event: "attribution",
        payload: record,
        timestamp: record.timestamp,
      });
    }
  }

  query(filter?: AttributionFilter): AttributionRecord[] {
    let results = this.records;

    if (filter?.category) {
      results = results.filter((r) => r.category === filter.category);
    }

    if (filter?.sessionId) {
      results = results.filter((r) => r.sessionId === filter.sessionId);
    }

    if (filter?.since) {
      results = results.filter((r) => r.timestamp >= filter.since!);
    }

    return results;
  }
}
