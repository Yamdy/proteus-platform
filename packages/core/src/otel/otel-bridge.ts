import type { ProteusTracer, ProteusSpan, ProteusMetric } from "./types.js";
import type { HandlerDefinition, PhaseName } from "../types.js";
import type { HandlerEngine } from "../handler-engine.js";

interface SpanStack {
  chainSpan?: ProteusSpan;
  turnSpan?: ProteusSpan;
  phaseSpan?: ProteusSpan;
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

  handlePhaseBefore(p: { phaseName: PhaseName; session?: { sessionId: string }; turn?: { turnId: string } }): void {
    if (!p.session?.sessionId) return;
    const s = this.getStack(p.session.sessionId);
    s.phaseSpan = this.tracer.startSpan(`phase:${p.phaseName}`, s.turnSpan ?? s.chainSpan, {
      "phase.name": p.phaseName,
      ...(p.turn?.turnId ? { "turn.id": p.turn.turnId } : {}),
    });
  }

  handlePhaseAfter(p: { phaseName: PhaseName; session?: { sessionId: string }; turn?: { turnId: string } }): void {
    if (!p.session?.sessionId) return;
    const s = this.getStack(p.session.sessionId);
    if (s.phaseSpan) {
      s.phaseSpan.setStatus("ok");
      s.phaseSpan.end();
      if (p.phaseName === "llm_inference") {
        this.metric.recordHistogram("proteus.llm.latency", Date.now() - s.phaseSpan.startTime);
      }
      s.phaseSpan = undefined;
    }
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
  ];
}

export function registerOTelBridge(engine: HandlerEngine, tracer: ProteusTracer, metric: ProteusMetric): void {
  for (const h of createOTelBridgeHandlers(tracer, metric)) engine.register(h);
}
