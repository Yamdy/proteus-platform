import { describe, it, expect } from "vitest";
import { ETCLOVGLayer, InMemoryAttributionStore, attributeFailure } from "./failure-attribution.js";
import type { AttributionRecord } from "./failure-attribution.js";
import { createInMemoryStore } from "./checkpoint-store.js";

// --- ETCLOVGLayer ---

describe("ETCLOVGLayer", () => {
  it("defines all 7 categories", () => {
    expect(ETCLOVGLayer.E).toBe("E");
    expect(ETCLOVGLayer.T).toBe("T");
    expect(ETCLOVGLayer.C).toBe("C");
    expect(ETCLOVGLayer.L).toBe("L");
    expect(ETCLOVGLayer.O).toBe("O");
    expect(ETCLOVGLayer.V).toBe("V");
    expect(ETCLOVGLayer.G).toBe("G");
  });
});

// --- attributeFailure ---

describe("attributeFailure", () => {
  it("maps tool_execution phase error to T", () => {
    const record = attributeFailure({
      phase: "tool_execution",
      error: new Error("tool failed"),
    });
    expect(record.category).toBe("T");
    expect(record.phase).toBe("tool_execution");
  });

  it("maps context_assembly phase error to C", () => {
    const record = attributeFailure({
      phase: "context_assembly",
      error: new Error("context too long"),
    });
    expect(record.category).toBe("C");
  });

  it("maps llm_inference phase error to L", () => {
    const record = attributeFailure({
      phase: "llm_inference",
      error: new Error("LLM timeout"),
    });
    expect(record.category).toBe("L");
  });

  it("maps governance abort to G", () => {
    const record = attributeFailure({
      phase: "governance",
      error: new Error("permission denied"),
    });
    expect(record.category).toBe("G");
  });

  it("maps handler error with trust to E", () => {
    const record = attributeFailure({
      phase: "handler",
      error: new Error("handler crashed"),
      trust: 3,
    });
    expect(record.category).toBe("E");
  });

  it("defaults to O for unknown phase", () => {
    const record = attributeFailure({
      phase: "unknown_phase",
      error: new Error("something"),
    });
    expect(record.category).toBe("O");
  });
});

// --- InMemoryAttributionStore ---

describe("InMemoryAttributionStore", () => {
  it("saves and retrieves attribution records", () => {
    const store = new InMemoryAttributionStore();
    const record: AttributionRecord = {
      category: "T",
      phase: "tool_execution",
      error: "tool failed",
      timestamp: Date.now(),
    };
    store.save(record);
    const records = store.query();
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  it("filters by category", () => {
    const store = new InMemoryAttributionStore();
    store.save({ category: "T", phase: "tool_execution", error: "e1", timestamp: 1 });
    store.save({ category: "L", phase: "llm_inference", error: "e2", timestamp: 2 });
    store.save({ category: "T", phase: "tool_execution", error: "e3", timestamp: 3 });

    const tRecords = store.query({ category: "T" });
    expect(tRecords).toHaveLength(2);
    expect(tRecords.every((r) => r.category === "T")).toBe(true);
  });

  it("persists to CheckpointStore event log", () => {
    const checkpointStore = createInMemoryStore();
    const store = new InMemoryAttributionStore(checkpointStore);
    const record: AttributionRecord = {
      category: "C",
      phase: "context_assembly",
      error: "context overflow",
      timestamp: Date.now(),
      sessionId: "s1",
    };
    store.save(record);

    const events = checkpointStore.queryEvents("s1");
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("attribution");
    expect(events[0].payload).toEqual(record);
  });
});
