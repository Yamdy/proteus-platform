import { describe, it, expect } from "vitest";
import { CostAttributionTracker } from "./cost-tracker.js";

describe("CostAttributionTracker", () => {
  it("tracks a single cost entry", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "agent-a", tokens: 1000, cost: 0.002 });

    const costs = tracker.getAgentCosts("agent-a");
    expect(costs).toHaveLength(1);
    expect(costs[0].agentId).toBe("agent-a");
    expect(costs[0].tokens).toBe(1000);
    expect(costs[0].cost).toBe(0.002);
  });

  it("returns empty array for unknown agent", () => {
    const tracker = new CostAttributionTracker();
    expect(tracker.getAgentCosts("unknown")).toEqual([]);
  });

  it("tracks multiple entries for the same agent", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "agent-a", tokens: 500, cost: 0.001 });
    tracker.trackCost({ agentId: "agent-a", tokens: 300, cost: 0.0006 });

    const costs = tracker.getAgentCosts("agent-a");
    expect(costs).toHaveLength(2);
    expect(tracker.getTotalCost("agent-a")).toBeCloseTo(0.0016);
  });

  it("getTotalCost returns only direct costs when no children", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "agent-a", tokens: 1000, cost: 0.002 });
    tracker.trackCost({ agentId: "agent-b", tokens: 500, cost: 0.001 });

    expect(tracker.getTotalCost("agent-a")).toBeCloseTo(0.002);
    expect(tracker.getTotalCost("agent-b")).toBeCloseTo(0.001);
  });

  it("getTotalCost includes child agent costs", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "agent-a", tokens: 1000, cost: 0.002 });
    tracker.trackCost({ agentId: "agent-b", tokens: 500, cost: 0.001, parentAgentId: "agent-a" });

    // agent-a total = own (0.002) + child agent-b (0.001) = 0.003
    expect(tracker.getTotalCost("agent-a")).toBeCloseTo(0.003);
    // agent-b total = own only (0.001)
    expect(tracker.getTotalCost("agent-b")).toBeCloseTo(0.001);
  });

  it("getTotalCost handles multi-level hierarchy", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "root", tokens: 1000, cost: 0.002 });
    tracker.trackCost({ agentId: "child-1", tokens: 500, cost: 0.001, parentAgentId: "root" });
    tracker.trackCost({ agentId: "child-2", tokens: 300, cost: 0.0006, parentAgentId: "root" });
    tracker.trackCost({ agentId: "grandchild", tokens: 200, cost: 0.0004, parentAgentId: "child-1" });

    // root = 0.002 + child-1 (0.001 + grandchild 0.0004) + child-2 (0.0006) = 0.004
    expect(tracker.getTotalCost("root")).toBeCloseTo(0.004);
    // child-1 = 0.001 + grandchild (0.0004) = 0.0014
    expect(tracker.getTotalCost("child-1")).toBeCloseTo(0.0014);
    // child-2 = 0.0006
    expect(tracker.getTotalCost("child-2")).toBeCloseTo(0.0006);
    // grandchild = 0.0004
    expect(tracker.getTotalCost("grandchild")).toBeCloseTo(0.0004);
  });

  it("handles circular references without infinite loop", () => {
    const tracker = new CostAttributionTracker();
    // Simulate a cycle (shouldn't happen in practice, but defensive)
    tracker.trackCost({ agentId: "a", tokens: 100, cost: 0.001, parentAgentId: "b" });
    tracker.trackCost({ agentId: "b", tokens: 100, cost: 0.001, parentAgentId: "a" });

    // Should not hang — visited set prevents cycles
    expect(tracker.getTotalCost("a")).toBeCloseTo(0.002);
    expect(tracker.getTotalCost("b")).toBeCloseTo(0.002);
  });

  it("clear removes all entries", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "agent-a", tokens: 1000, cost: 0.002 });
    tracker.clear();

    expect(tracker.getAgentCosts("agent-a")).toEqual([]);
    expect(tracker.getTotalCost("agent-a")).toBe(0);
    expect(tracker.getAllEntries()).toEqual([]);
  });

  it("getAllEntries returns all recorded entries", () => {
    const tracker = new CostAttributionTracker();
    tracker.trackCost({ agentId: "a", tokens: 100, cost: 0.001 });
    tracker.trackCost({ agentId: "b", tokens: 200, cost: 0.002, parentAgentId: "a" });

    expect(tracker.getAllEntries()).toHaveLength(2);
  });

  it("trackCost does not mutate the input entry", () => {
    const tracker = new CostAttributionTracker();
    const entry = { agentId: "a", tokens: 100, cost: 0.001 };
    tracker.trackCost(entry);
    entry.tokens = 999;

    const stored = tracker.getAgentCosts("a");
    expect(stored[0].tokens).toBe(100);
  });

  it("getTotalCost returns 0 for unknown agent", () => {
    const tracker = new CostAttributionTracker();
    expect(tracker.getTotalCost("nonexistent")).toBe(0);
  });
});
