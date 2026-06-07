import type { DelegationRequest, DelegationResult } from "./types.js";
import type { AgentRegistry } from "./agent-registry.js";
import type { ProteusTracer, ProteusSpan } from "./otel/types.js";
import { Harness } from "./harness.js";
import { SessionContext } from "./context.js";
import { createInMemoryStore } from "./checkpoint-store.js";
import type { CostAttributionTracker } from "./cost-tracker.js";

/**
 * AgentRouter handles cross-Agent event routing.
 *
 * When Agent A delegates to Agent B:
 * 1. Resolves the target agent from AgentRegistry
 * 2. Emits delegation events for observability via HandlerEngine
 * 3. Creates a child span under the source agent's active span (if tracer provided)
 * 4. Creates a SubHarness and runs the delegated task
 * 5. Records cost attribution to parent agent (if CostAttributionTracker provided)
 */
export class AgentRouter {
  private readonly registry: AgentRegistry;
  private readonly tracer?: ProteusTracer;
  private readonly costTracker?: CostAttributionTracker;

  constructor(agentRegistry: AgentRegistry, tracer?: ProteusTracer, costTracker?: CostAttributionTracker) {
    this.registry = agentRegistry;
    this.tracer = tracer;
    this.costTracker = costTracker;
  }

  async delegate(
    request: DelegationRequest,
  ): Promise<{ ok: true; result: DelegationResult } | { ok: false; reason: string }> {
    const startTime = Date.now();

    // Resolve source agent (for emitting events)
    const fromAgent = this.registry.get(request.fromAgentId);
    if (!fromAgent) {
      return { ok: false, reason: `Source agent "${request.fromAgentId}" not found` };
    }

    // Resolve target agent
    const toAgent = this.registry.get(request.toAgentId);
    if (!toAgent) {
      return { ok: false, reason: `Target agent "${request.toAgentId}" not found` };
    }

    // Create a delegation span under the source agent's active span
    let delegationSpan: ProteusSpan | undefined;
    if (this.tracer) {
      const parentSpan = this.tracer.getActiveSpan();
      delegationSpan = this.tracer.startSpan("delegation", parentSpan, {
        "agent.id": request.fromAgentId,
        "agent.name": request.fromAgentId,
        "delegation.from": request.fromAgentId,
        "delegation.to": request.toAgentId,
        "delegation.task": request.task,
      });
    }

    // Emit delegation:start event for observability
    await fromAgent.handlerEngine.emit("delegation:start", {
      fromAgentId: request.fromAgentId,
      toAgentId: request.toAgentId,
      task: request.task,
      metadata: request.metadata,
    });

    try {
      // Create SubHarness with an in-memory store for the delegated task
      const store = createInMemoryStore();
      const harness = new Harness({ store });

      // Create a session for the delegation
      const sessionId = `delegation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const session = new SessionContext({
        sessionId,
        llm: { provider: "delegation", model: "unknown", temperature: 0 },
        tools: {},
        logLevel: "info",
      });

      // Run a single turn on the target agent
      const turnResult = await harness.runTurn(session, toAgent);

      // Record cost attribution if tracker is available
      if (this.costTracker) {
        const totals = session.costTracker.getTotals();
        const totalTokens = totals.promptTokens + totals.completionTokens;
        if (totalTokens > 0) {
          this.costTracker.trackCost({
            agentId: request.toAgentId,
            tokens: totalTokens,
            cost: totalTokens / 1000 * 0.001,
            parentAgentId: request.fromAgentId,
          });
        }
      }

      const duration = Date.now() - startTime;

      const delegationResult: DelegationResult = {
        ok: turnResult.status === "completed",
        result: turnResult.status === "completed" ? { turnId: turnResult.turnId } : undefined,
        error: turnResult.status !== "completed" ? `Turn ended with status: ${turnResult.status}` : undefined,
        duration,
      };

      // End delegation span on success
      if (delegationSpan) {
        delegationSpan.setStatus("ok");
        delegationSpan.end();
      }

      // Emit delegation:end event
      await fromAgent.handlerEngine.emit("delegation:end", {
        fromAgentId: request.fromAgentId,
        toAgentId: request.toAgentId,
        task: request.task,
        result: delegationResult,
      });

      return { ok: true, result: delegationResult };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // End delegation span on error
      if (delegationSpan) {
        delegationSpan.setStatus("error", errorMessage);
        delegationSpan.setAttribute("error.message", errorMessage);
        delegationSpan.end();
      }

      // Emit delegation:error event
      await fromAgent.handlerEngine.emit("delegation:error", {
        fromAgentId: request.fromAgentId,
        toAgentId: request.toAgentId,
        task: request.task,
        error: errorMessage,
      });

      return {
        ok: true,
        result: {
          ok: false,
          error: errorMessage,
          duration,
        },
      };
    }
  }
}
