import type { KnowledgeEntry, KnowledgeQuery } from "../types.js";

/** Access mode for knowledge operations. */
export type KnowledgeAccessMode = "read" | "write" | "delete";

/** Result of a policy check. */
export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

/**
 * KnowledgeAccessPolicy controls who can read/write/delete knowledge entries.
 *
 * Implementations should be stateless and composable.
 */
export interface KnowledgeAccessPolicy {
  /** Human-readable policy name. */
  readonly name: string;

  /** Check if an agent is allowed to perform the given operation. */
  check(params: {
    agentId: string;
    mode: KnowledgeAccessMode;
    entry?: KnowledgeEntry;
    query?: KnowledgeQuery;
  }): PolicyDecision;
}

/** Allows all operations for all agents. */
export class AllowAllPolicy implements KnowledgeAccessPolicy {
  readonly name = "allow-all";

  check(_params?: { agentId: string; mode: KnowledgeAccessMode }): PolicyDecision {
    return { allowed: true, reason: "all operations allowed" };
  }
}

/** Denies operations on entries tagged with specified deny-tags. */
export class DenyTagPolicy implements KnowledgeAccessPolicy {
  readonly name = "deny-tag";

  constructor(private readonly denyTags: string[]) {}

  check(params: {
    agentId: string;
    mode: KnowledgeAccessMode;
    entry?: KnowledgeEntry;
  }): PolicyDecision {
    if (!params.entry) {
      return { allowed: true, reason: "no entry to check" };
    }
    const hasDenyTag = params.entry.tags.some((t) => this.denyTags.includes(t));
    if (hasDenyTag) {
      return {
        allowed: false,
        reason: `entry has denied tag (one of: ${this.denyTags.join(", ")})`,
      };
    }
    return { allowed: true, reason: "no denied tags" };
  }
}

/** Restricts write/delete to the agent that created the entry. */
export class OwnerOnlyWritePolicy implements KnowledgeAccessPolicy {
  readonly name = "owner-only-write";

  check(params: {
    agentId: string;
    mode: KnowledgeAccessMode;
    entry?: KnowledgeEntry;
  }): PolicyDecision {
    if (params.mode === "read") {
      return { allowed: true, reason: "reads are always allowed" };
    }
    if (!params.entry) {
      return { allowed: true, reason: "no entry to check" };
    }
    if (params.entry.agentId && params.entry.agentId !== params.agentId) {
      return {
        allowed: false,
        reason: `agent "${params.agentId}" is not the owner (owner: "${params.entry.agentId}")`,
      };
    }
    return { allowed: true, reason: "agent is owner" };
  }
}

/**
 * Composite policy: evaluates policies in order.
 * First deny wins (short-circuit).
 */
export class CompositePolicy implements KnowledgeAccessPolicy {
  readonly name: string;

  constructor(private readonly policies: KnowledgeAccessPolicy[]) {
    this.name = `composite(${policies.map((p) => p.name).join(", ")})`;
  }

  check(params: {
    agentId: string;
    mode: KnowledgeAccessMode;
    entry?: KnowledgeEntry;
    query?: KnowledgeQuery;
  }): PolicyDecision {
    for (const policy of this.policies) {
      const decision = policy.check(params);
      if (!decision.allowed) {
        return decision;
      }
    }
    return { allowed: true, reason: "all policies passed" };
  }
}
