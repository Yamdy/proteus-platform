import type { ProteusTracer, ProteusSpan, ProteusMetric } from "./types.js";
import type { HandlerDefinition, PhaseName } from "../types.js";
import type { HandlerEngine } from "../handler-engine.js";

interface SpanStack {
  chainSpan?: ProteusSpan;
  turnSpan?: ProteusSpan;
  phaseSpan?: ProteusSpan;
  delegationSpan?: ProteusSpan;
  turnStartTime?: number;
}

export class OTelBridgeHandler {
  private readonly tracer: ProteusTracer;
  private readonly metric: ProteusMetric;
  private readonly stacks = new Map<string, SpanStack>();

  constructor(tracer: ProteusTracer, metric: ProteusMetric) {
    this.tracer = tracer;
    this.metric = metric;
  }

  private getStack(sessionId: string): SpanStack {
    let s = this.stacks.get(sessionId);
    if (!s) { s = {}; this.stacks.set(sessionId, s); }
    return s;
  }

  handleChainStart(p: { chainId: string; sessionId: string }): void {
    const s = this.getStack(p.sessionId);
    s.chainSpan = this.tracer.startSpan("chain", undefined, { "chain.id": p.chainId, "session.id": p.sessionId });
    this.metric.setGauge("proteus.chain.active", 1, { session_id: p.sessionId });
  }

  handleChainEnd(p: { chainId: string; sessionId: string; status: string; turns?: number }): void {
    const s = this.getStack(p.sessionId);
    if (s.chainSpan) {
      s.chainSpan.setStatus(p.status === "errored" ? "error" : "ok");
      s.chainSpan.end();
      s.chainSpan = undefined;
    }
    this.metric.setGauge("proteus.chain.active", -1, { session_id: p.sessionId });
  }

  handleTurnStart(p: { turnId: string; sessionId: string }): void {
    const s = this.getStack(p.sessionId);
    s.turnSpan = this.tracer.startSpan("turn", s.chainSpan, { "turn.id": p.turnId, "session.id": p.sessionId });
    s.turnStartTime = Date.now();
  }

  handleTurnEnd(p: { turnId: string; sessionId?: string; status: string; error?: Error }): void {
    const s = p.sessionId ? this.getStack(p.sessionId) : this.findActiveTurnStack();
    if (s?.turnSpan) {
      if (p.status === "errored") {
        s.turnSpan.setStatus("error", p.error?.message ?? "errored");
        if (p.error) s.turnSpan.setAttribute("error.message", p.error.message);
      } else {
        s.turnSpan.setStatus("ok");
      }
      s.turnSpan.end();
      s.turnSpan = undefined;
    }
    this.metric.incrementCounter("proteus.turn.total", 1, { status: p.status });
    if (s?.turnStartTime) {
      this.metric.recordHistogram("proteus.turn.duration", Date.now() - s.turnStartTime, { status: p.status });
      s.turnStartTime = undefined;
    }
  }

  handlePhaseBefore(p: { phaseName: PhaseName; session?: { sessionId: string }; turn?: { turnId: string }; payload?: Record<string, unknown> }): void {
    if (!p.session?.sessionId) return;
    const s = this.getStack(p.session.sessionId);
    s.phaseSpan = this.tracer.startSpan(`phase:${p.phaseName}`, s.turnSpan ?? s.chainSpan, {
      "phase.name": p.phaseName,
      ...(p.turn?.turnId ? { "turn.id": p.turn.turnId } : {}),
    });

    if (p.phaseName === "context_assembly" && p.payload?.systemPrompt != null) {
      const prompt = String(p.payload.systemPrompt);
      s.phaseSpan.setAttribute("context.system_prompt", prompt.length > 2000 ? prompt.slice(0, 2000) : prompt);
    }
  }

  handlePhaseAfter(p: { phaseName: PhaseName; session?: { sessionId: string }; turn?: { turnId: string }; payload?: Record<string, unknown> }): void {
    if (!p.session?.sessionId) return;
    const s = this.getStack(p.session.sessionId);
    if (s.phaseSpan) {
      // Set phase-specific attributes before ending
      if (p.phaseName === "tool_execution" && Array.isArray(p.payload?.toolCalls)) {
        const calls = p.payload.toolCalls as Array<{ name?: string; input?: unknown; output?: unknown; success?: boolean }>;
        s.phaseSpan.setAttribute("tool.calls_count", calls.length);
        for (let i = 0; i < calls.length; i++) {
          const tc = calls[i];
          if (tc.name != null) s.phaseSpan.setAttribute(`tool.${i}.name`, String(tc.name));
          if (tc.input != null) {
            const json = JSON.stringify(tc.input);
            s.phaseSpan.setAttribute(`tool.${i}.input`, json.length > 1000 ? json.slice(0, 1000) : json);
          }
          if (tc.output != null) {
            const json = JSON.stringify(tc.output);
            s.phaseSpan.setAttribute(`tool.${i}.output`, json.length > 1000 ? json.slice(0, 1000) : json);
          }
          if (tc.success != null) s.phaseSpan.setAttribute(`tool.${i}.success`, tc.success);
        }
      }

      if (p.phaseName === "llm_inference") {
        if (p.payload?.usage != null && typeof p.payload.usage === "object") {
          const usage = p.payload.usage as Record<string, unknown>;
          if (usage.input_tokens != null) s.phaseSpan.setAttribute("llm.input_tokens", Number(usage.input_tokens));
          if (usage.output_tokens != null) s.phaseSpan.setAttribute("llm.output_tokens", Number(usage.output_tokens));
        }
        this.metric.recordHistogram("proteus.llm.latency", Date.now() - s.phaseSpan.startTime);
      }

      s.phaseSpan.setStatus("ok");
      s.phaseSpan.end();
      s.phaseSpan = undefined;
    }
  }

  handleDelegationStart(p: {
    fromAgentId: string;
    toAgentId: string;
    task: string;
    sessionId?: string;
    parentSpan?: ProteusSpan;
  }): ProteusSpan {
    const parent = p.parentSpan ?? this.findActiveSpan();
    const span = this.tracer.startSpan("delegation", parent, {
      "agent.id": p.fromAgentId,
      "agent.name": p.fromAgentId,
      "delegation.from": p.fromAgentId,
      "delegation.to": p.toAgentId,
      "delegation.task": p.task,
    });

    // Store as active delegation span for the target agent's session
    if (p.sessionId) {
      const s = this.getStack(p.sessionId);
      s.delegationSpan = span;
    }

    this.metric.incrementCounter("proteus.delegation.total", 1, {
      from: p.fromAgentId,
      to: p.toAgentId,
    });

    return span;
  }

  handleDelegationEnd(p: {
    fromAgentId: string;
    toAgentId: string;
    status: "ok" | "error";
    error?: string;
    sessionId?: string;
    delegationSpan?: ProteusSpan;
  }): void {
    const span = p.delegationSpan
      ?? (p.sessionId ? this.getStack(p.sessionId).delegationSpan : undefined)
      ?? this.findActiveDelegationSpan();

    if (span) {
      span.setStatus(p.status, p.error);
      if (p.error) span.setAttribute("error.message", p.error);
      span.end();

      // Clear from stack
      if (p.sessionId) {
        const s = this.getStack(p.sessionId);
        if (s.delegationSpan === span) s.delegationSpan = undefined;
      }
    }

    this.metric.incrementCounter("proteus.delegation.completed", 1, {
      from: p.fromAgentId,
      to: p.toAgentId,
      status: p.status,
    });
  }

  private findActiveSpan(): ProteusSpan | undefined {
    for (const [, s] of this.stacks) {
      if (s.phaseSpan) return s.phaseSpan;
      if (s.turnSpan) return s.turnSpan;
      if (s.chainSpan) return s.chainSpan;
    }
    return undefined;
  }

  private findActiveDelegationSpan(): ProteusSpan | undefined {
    for (const [, s] of this.stacks) { if (s.delegationSpan) return s.delegationSpan; }
    return undefined;
  }

  private findActiveTurnStack(): SpanStack | undefined {
    for (const [, s] of this.stacks) { if (s.turnSpan) return s; }
    return undefined;
  }
}

const PHASES: PhaseName[] = ["context_assembly", "llm_inference", "action_resolution", "tool_execution", "result_observation"];

export function createOTelBridgeHandlers(tracer: ProteusTracer, metric: ProteusMetric): HandlerDefinition[] {
  const b = new OTelBridgeHandler(tracer, metric);
  const mk = (name: string, events: string[], fn: (p: any) => void, phases?: string[]): HandlerDefinition => ({
    name, events, phases: phases as PhaseName[] | undefined, priority: 30, trust: 3, builtin: true,
    handle: async (p) => { fn(p); return { ok: true }; },
  });
  return [
    mk("otel-bridge:chain-start", ["chain:start"], p => b.handleChainStart(p)),
    mk("otel-bridge:chain-end", ["chain:end"], p => b.handleChainEnd(p)),
    mk("otel-bridge:turn-start", ["turn:start"], p => b.handleTurnStart(p)),
    mk("otel-bridge:turn-end", ["turn:end"], p => b.handleTurnEnd(p)),
    mk("otel-bridge:phase-before", ["phase:before"], p => b.handlePhaseBefore(p), PHASES),
    mk("otel-bridge:phase-after", ["phase:after"], p => b.handlePhaseAfter(p), PHASES),
    mk("otel-bridge:delegation-start", ["delegation:start"], p => b.handleDelegationStart(p)),
    mk("otel-bridge:delegation-end", ["delegation:end"], p => b.handleDelegationEnd(p)),
  ];
}

export function registerOTelBridge(engine: HandlerEngine, tracer: ProteusTracer, metric: ProteusMetric): void {
  for (const h of createOTelBridgeHandlers(tracer, metric)) engine.register(h);
}
