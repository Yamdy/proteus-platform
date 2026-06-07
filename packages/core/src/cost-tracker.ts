import type { CostEntry } from "./types.js";

/**
 * CostAttributionTracker: Tracks LLM cost entries across agent hierarchies.
 *
 * Each CostEntry records the agent that incurred the cost and optionally
 * the parent agent that delegated the work. getTotalCost() recursively
 * sums an agent's own costs plus all its descendants' costs.
 */
export class CostAttributionTracker {
  private readonly entries: CostEntry[] = [];

  /**
   * Record a cost entry.
   */
  trackCost(entry: CostEntry): void {
    this.entries.push({ ...entry });
  }

  /**
   * Get all cost entries attributed directly to the given agent.
   */
  getAgentCosts(agentId: string): CostEntry[] {
    return this.entries.filter((e) => e.agentId === agentId);
  }

  /**
   * Get total cost for an agent, including costs from all descendant agents.
   *
   * Walks the parentAgentId chain recursively: if agent B has
   * parentAgentId=A, then B's costs are included in A's total.
   */
  getTotalCost(agentId: string): number {
    const visited = new Set<string>();
    return this.sumDescendantCost(agentId, visited);
  }

  /**
   * Get all recorded entries (for debugging / inspection).
   */
  getAllEntries(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.length = 0;
  }

  // --- Private ---

  private sumDescendantCost(agentId: string, visited: Set<string>): number {
    if (visited.has(agentId)) return 0;
    visited.add(agentId);

    let total = 0;
    for (const entry of this.entries) {
      if (entry.agentId === agentId) {
        total += entry.cost;
      }
    }

    // Find direct children and sum their costs recursively
    const children = new Set<string>();
    for (const entry of this.entries) {
      if (entry.parentAgentId === agentId) {
        children.add(entry.agentId);
      }
    }

    for (const childId of children) {
      total += this.sumDescendantCost(childId, visited);
    }

    return total;
  }
}
