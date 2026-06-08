import type {
  HandlerDefinition,
  HandlerResult,
  GovernanceDecision,
  GovernanceHookName,
  AuditLog,
} from "../types.js";
import type { HandlerContext } from "../context.js";

// --- InMemoryAuditLog ---

export class InMemoryAuditLog implements AuditLog {
  private readonly decisions: GovernanceDecision[] = [];

  log(decision: GovernanceDecision): void {
    this.decisions.push(decision);
  }

  query(filter?: {
    hook?: GovernanceHookName;
    agentId?: string;
    action?: string;
  }): GovernanceDecision[] {
    let results = [...this.decisions];
    if (filter?.hook) {
      results = results.filter((d) => d.hook === filter.hook);
    }
    if (filter?.agentId) {
      results = results.filter((d) => d.agentId === filter.agentId);
    }
    if (filter?.action) {
      results = results.filter((d) => d.action === filter.action);
    }
    return results;
  }

  get size(): number {
    return this.decisions.length;
  }

  clear(): void {
    this.decisions.length = 0;
  }
}

// --- Governance Hook Factories ---

/** Type for a governance check function. */
export type GovernanceCheckFn = (
  ctx: HandlerContext,
) => Promise<HandlerResult | null>;

/**
 * H1 = Input Validation (context_assembly phase:before)
 * Guards against prompt injection and validates input.
 */
export function createH1Hook(
  check: GovernanceCheckFn,
  auditLog?: AuditLog,
): HandlerDefinition {
  return {
    name: "governance-h1-input-validation",
    phases: ["context_assembly"],
    events: ["phase:before"],
    priority: 1, // Run before other interceptors
    trust: 1,
    builtin: false,
    handle: async (ctx: HandlerContext): Promise<HandlerResult> => {
      const result = await check(ctx);
      if (result) {
        auditLog?.log({
          hook: "H1",
          action: "ok" in result && !result.ok ? "deny" : "allow",
          reason:
            "ok" in result && !result.ok
              ? (result as { ok: false; reason: string }).reason
              : "input validation passed",
          agentId: ctx.session.sessionId,
          timestamp: Date.now(),
        });
        return result;
      }
      auditLog?.log({
        hook: "H1",
        action: "allow",
        reason: "no check configured, default allow",
        agentId: ctx.session.sessionId,
        timestamp: Date.now(),
      });
      return { ok: true };
    },
  };
}

/**
 * H2 = Action Validation (tool_execution phase:before)
 * Permission check before tool execution. Can return suspend for human approval.
 */
export function createH2Hook(
  check: GovernanceCheckFn,
  auditLog?: AuditLog,
): HandlerDefinition {
  return {
    name: "governance-h2-action-validation",
    phases: ["tool_execution"],
    events: ["phase:before"],
    priority: 1,
    trust: 1,
    builtin: false,
    handle: async (ctx: HandlerContext): Promise<HandlerResult> => {
      const result = await check(ctx);
      if (result) {
        const action: GovernanceDecision["action"] =
          "suspend" in result && result.suspend
            ? "suspend"
            : "ok" in result && !result.ok
              ? "deny"
              : "allow";
        auditLog?.log({
          hook: "H2",
          action,
          reason:
            action === "deny"
              ? (result as { ok: false; reason: string }).reason
              : action === "suspend"
                ? "pending human approval"
                : "action validation passed",
          agentId: ctx.session.sessionId,
          toolName: ctx.turn.toolCalls?.[0]?.name,
          timestamp: Date.now(),
        });
        return result;
      }
      auditLog?.log({
        hook: "H2",
        action: "allow",
        reason: "no check configured, default allow",
        agentId: ctx.session.sessionId,
        timestamp: Date.now(),
      });
      return { ok: true };
    },
  };
}

/**
 * H3 = Output Filtering (tool_execution phase:after)
 * Filters sensitive information from tool output.
 */
export function createH3Hook(
  check: GovernanceCheckFn,
  auditLog?: AuditLog,
): HandlerDefinition {
  return {
    name: "governance-h3-output-filter",
    phases: ["tool_execution"],
    events: ["phase:after"],
    priority: 1,
    trust: 1,
    builtin: false,
    handle: async (ctx: HandlerContext): Promise<HandlerResult> => {
      const result = await check(ctx);
      if (result) {
        auditLog?.log({
          hook: "H3",
          action: "ok" in result && !result.ok ? "deny" : "allow",
          reason:
            "ok" in result && !result.ok
              ? (result as { ok: false; reason: string }).reason
              : "output filter passed",
          agentId: ctx.session.sessionId,
          timestamp: Date.now(),
        });
        return result;
      }
      return { ok: true };
    },
  };
}

/**
 * H4 = Human-in-the-loop (result_observation phase:before)
 * Returns suspend to pause for human approval before final response.
 */
export function createH4Hook(
  check: GovernanceCheckFn,
  auditLog?: AuditLog,
): HandlerDefinition {
  return {
    name: "governance-h4-human-approval",
    phases: ["result_observation"],
    events: ["phase:before"],
    priority: 1,
    trust: 1,
    builtin: false,
    handle: async (ctx: HandlerContext): Promise<HandlerResult> => {
      const result = await check(ctx);
      if (result) {
        const action: GovernanceDecision["action"] =
          "suspend" in result && result.suspend
            ? "suspend"
            : "ok" in result && !result.ok
              ? "deny"
              : "allow";
        auditLog?.log({
          hook: "H4",
          action,
          reason:
            action === "suspend"
              ? "pending human approval"
              : action === "deny"
                ? (result as { ok: false; reason: string }).reason
                : "human approval passed",
          agentId: ctx.session.sessionId,
          timestamp: Date.now(),
        });
        return result;
      }
      return { ok: true };
    },
  };
}

/**
 * Convenience: register all H1-H4 hooks on a HandlerEngine.
 */
export function registerGovernanceHooks(
  engine: { register(def: HandlerDefinition): void },
  hooks: {
    h1?: GovernanceCheckFn;
    h2?: GovernanceCheckFn;
    h3?: GovernanceCheckFn;
    h4?: GovernanceCheckFn;
  },
  auditLog?: AuditLog,
): void {
  if (hooks.h1) engine.register(createH1Hook(hooks.h1, auditLog));
  if (hooks.h2) engine.register(createH2Hook(hooks.h2, auditLog));
  if (hooks.h3) engine.register(createH3Hook(hooks.h3, auditLog));
  if (hooks.h4) engine.register(createH4Hook(hooks.h4, auditLog));
}
