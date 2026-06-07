import { SessionContext, TurnContext, HandlerContext as HandlerContextClass, FrozenContext } from "./context.js";
import type { AgentContext } from "./context.js";
import type { CheckpointLog } from "./checkpoint-store.js";
import type { HandlerResult } from "./types.js";
import type { PhaseName } from "./types.js";
import { LifecycleStateMachine } from "./lifecycle.js";
import { isBlock, isAbort, isSuspend, isTerminalError } from "./handler-engine.js";
import { ContextAssemblyProcessor, LLMInferenceProcessor, ActionResolutionProcessor, ToolExecutionProcessor, ResultObservationProcessor } from "./processors.js";

const PHASES: PhaseName[] = [
  "context_assembly",
  "llm_inference",
  "action_resolution",
  "tool_execution",
  "result_observation",
];

export interface TurnResult {
  status: "completed" | "aborted" | "suspended" | "errored";
  turnId: string;
  error?: Error;
  suspendInput?: unknown;
}

export interface ChainOptions {
  maxTurns?: number;
  abortSignal?: AbortSignal;
}

export interface ChainResult {
  status: "completed" | "max_turns" | "aborted" | "suspended" | "errored";
  turns: number;
  error?: Error;
}

export interface HarnessOptions {
  store: CheckpointLog;
}

export interface TurnCallbacks {
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;
}

/**
 * D5 Harness: Processor execution separated from HandlerEngine events.
 *
 * - Processors are called independently by the Harness (not as handlers)
 * - phase:before/after events are only for interceptors/observers
 * - This restores ADR-0001 Gate/Processor separation semantics
 */
export class Harness {
  private readonly store: CheckpointLog;
  readonly lifecycle: LifecycleStateMachine;

  constructor(opts: HarnessOptions) {
    this.store = opts.store;
    this.lifecycle = new LifecycleStateMachine();
  }

  async runTurn(session: SessionContext, agent: AgentContext, opts?: { callbacks?: TurnCallbacks }): Promise<TurnResult> {
    if (this.lifecycle.state === "pending") {
      this.lifecycle.transition("start");
    }

    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const turn = new TurnContext({ turnId, agent, session });
    if (opts?.callbacks?.onToken) turn.onToken = opts.callbacks.onToken;
    if (opts?.callbacks?.onThinking) turn.onThinking = opts.callbacks.onThinking;
    const ctx = new HandlerContextClass({ agent, session, turn });

    return this.executePhases(ctx, turnId, session.sessionId, agent);
  }

  async resume(sessionId: string, agent: AgentContext, externalInput?: unknown, opts?: { callbacks?: TurnCallbacks }): Promise<TurnResult> {
    const checkpoint = this.store.loadLatestCheckpoint(sessionId);
    if (!checkpoint || checkpoint.resumeReason !== "suspend") {
      throw new Error(`No suspend checkpoint found for session "${sessionId}"`);
    }

    this.lifecycle.transition("resume");

    const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const session = new SessionContext({
      sessionId,
      llm: { provider: "unknown", model: "unknown", temperature: 0 },
      tools: {},
      logLevel: "info",
    });
    const turn = new TurnContext({ turnId, agent, session });
    turn.externalInput = externalInput;
    if (opts?.callbacks?.onToken) turn.onToken = opts.callbacks.onToken;
    if (opts?.callbacks?.onThinking) turn.onThinking = opts.callbacks.onThinking;
    const ctx = new HandlerContextClass({ agent, session, turn });

    return this.executePhases(ctx, turnId, sessionId, agent);
  }

  async runChain(session: SessionContext, agent: AgentContext, opts?: ChainOptions): Promise<ChainResult> {
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const engine = agent.handlerEngine;

    await engine.emit("chain:start", { chainId, sessionId: session.sessionId });

    const firstResult = await this.runTurn(session, agent);
    return this.runChainLoop(session, agent, opts, engine, chainId, session.sessionId, 0, firstResult);
  }

  async resumeChain(sessionId: string, agent: AgentContext, externalInput?: unknown, opts?: ChainOptions): Promise<ChainResult> {
    const chainId = `chain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const engine = agent.handlerEngine;

    await engine.emit("chain:start", { chainId, sessionId });

    const resumeResult = await this.resume(sessionId, agent, externalInput);
    const session = new SessionContext({
      sessionId,
      llm: { provider: "unknown", model: "unknown", temperature: 0 },
      tools: {},
      logLevel: "info",
    });
    return this.runChainLoop(session, agent, opts, engine, chainId, sessionId, 0, resumeResult, "completed");
  }

  private async runChainLoop(
    session: SessionContext,
    agent: AgentContext,
    opts: ChainOptions | undefined,
    engine: import("./context.js").HandlerEngineHandle,
    chainId: string,
    sessionId: string,
    completedTurns: number,
    currentResult: TurnResult,
    exhaustedStatus: "completed" | "max_turns" = "max_turns",
  ): Promise<ChainResult> {
    const maxTurns = opts?.maxTurns ?? 10;
    const abortSignal = opts?.abortSignal;

    if (currentResult.status === "suspended") {
      await engine.emit("chain:end", { chainId, sessionId, status: "suspended", turns: completedTurns + 1 });
      return { status: "suspended", turns: completedTurns + 1 };
    }
    if (currentResult.status === "aborted") {
      await engine.emit("chain:end", { chainId, sessionId, status: "aborted", turns: completedTurns + 1 });
      return { status: "aborted", turns: completedTurns + 1 };
    }
    if (currentResult.status === "errored") {
      await engine.emit("chain:end", { chainId, sessionId, status: "errored", turns: completedTurns + 1 });
      return { status: "errored", turns: completedTurns + 1, error: currentResult.error };
    }

    for (let i = completedTurns + 1; i < maxTurns; i++) {
      if (abortSignal?.aborted) {
        await engine.emit("chain:end", { chainId, sessionId, status: "aborted", turns: i });
        return { status: "aborted", turns: i };
      }

      const result = await this.runTurn(session, agent);

      if (result.status === "suspended") {
        await engine.emit("chain:end", { chainId, sessionId, status: "suspended", turns: i + 1 });
        return { status: "suspended", turns: i + 1 };
      }
      if (result.status === "aborted") {
        await engine.emit("chain:end", { chainId, sessionId, status: "aborted", turns: i + 1 });
        return { status: "aborted", turns: i + 1 };
      }
      if (result.status === "errored") {
        await engine.emit("chain:end", { chainId, sessionId, status: "errored", turns: i + 1 });
        return { status: "errored", turns: i + 1, error: result.error };
      }
    }

    await engine.emit("chain:end", { chainId, sessionId, status: exhaustedStatus, turns: maxTurns });
    return { status: exhaustedStatus, turns: maxTurns };
  }

  /**
   * D5: Execute phases with Processor separation.
   *
   * For each phase:
   * 1. Emit phase:before — interceptors can block/abort/suspend
   * 2. Call Processor independently (not through HandlerEngine)
   * 3. Emit phase:after — observers receive result
   */
  private async executePhases(ctx: HandlerContextClass, turnId: string, sessionId: string, agent: AgentContext): Promise<TurnResult> {
    const engine = agent.handlerEngine;

    await engine.emit("turn:start", { turnId, sessionId });

    for (const phaseName of PHASES) {
      const phasePayload = { phaseName, ...ctx };

      // 1. Interceptors get a chance to block
      const beforeResults = await engine.emit("phase:before", phasePayload);
      const blockResult = this.findBlock(beforeResults);
      if (blockResult) {
        await engine.emit("turn:end", { turnId, sessionId, status: "aborted" });
        return { status: "aborted", turnId };
      }

      const suspendResult = this.findSuspend(beforeResults);
      if (suspendResult) {
        const frozen = FrozenContext.forSuspend(ctx, suspendResult.pendingInput);
        this.store.saveCheckpoint(frozen);
        this.lifecycle.transition("suspend");
        await engine.emit("turn:end", { turnId, sessionId, status: "suspended" });
        return { status: "suspended", turnId, suspendInput: suspendResult.pendingInput };
      }

      const abortResult = this.findAbort(beforeResults);
      if (abortResult) {
        await engine.emit("turn:end", { turnId, sessionId, status: "aborted" });
        return { status: "aborted", turnId };
      }

      const errorResult = this.findTerminalError(beforeResults);
      if (errorResult) {
        await engine.emit("turn:end", { turnId, sessionId, status: "errored" });
        return { status: "errored", turnId, error: errorResult.error };
      }

      // 2. Processor runs independently (D5 key change)
      const processorResult = await this.runProcessor(phaseName, ctx);
      if (processorResult && "ok" in processorResult && !processorResult.ok) {
        await engine.emit("turn:end", { turnId, sessionId, status: "errored" });
        return { status: "errored", turnId, error: new Error((processorResult as any).reason ?? "Processor failed") };
      }

      // 3. Observers receive result
      await engine.emit("phase:after", phasePayload);
    }

    const frozen = ctx.freeze();
    this.store.saveCheckpoint(frozen);
    await engine.emit("turn:end", { turnId, sessionId, status: "completed" });

    return { status: "completed", turnId };
  }

  /**
   * D5: Run the processor for a given phase directly.
   * Processors are called independently by the Harness, not through HandlerEngine.
   */
  private async runProcessor(phaseName: PhaseName, ctx: HandlerContextClass): Promise<HandlerResult | undefined> {
    switch (phaseName) {
      case "context_assembly":
        return new ContextAssemblyProcessor().handle(ctx);
      case "llm_inference":
        return new LLMInferenceProcessor().handle(ctx);
      case "action_resolution":
        return new ActionResolutionProcessor().handle(ctx);
      case "tool_execution":
        return new ToolExecutionProcessor().handle(ctx);
      case "result_observation":
        return new ResultObservationProcessor().handle(ctx);
      default:
        return undefined;
    }
  }

  private findBlock(results: HandlerResult[]) { return results.find(isBlock); }
  private findSuspend(results: HandlerResult[]) { return results.find(r => isSuspend(r)) as any; }
  private findAbort(results: HandlerResult[]) { return results.find(isAbort); }
  private findTerminalError(results: HandlerResult[]) { return results.find(r => isTerminalError(r)) as any; }
}
