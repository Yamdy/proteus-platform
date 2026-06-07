import type { HandlerEngine } from "../handler-engine.js";

export interface MetricsSnapshot {
  turnCount: number;
  activeChains: number;
  lastTurnDuration: number;
  lastTurnStatus: string | null;
  consecutiveErrors: number;
  lastTurnTimestamp: number | null;
}

export class MetricsCollector {
  private turnCount = 0;
  private activeChains = 0;
  private lastTurnDuration = 0;
  private lastTurnStatus: string | null = null;
  private consecutiveErrors = 0;
  private lastTurnTimestamp: number | null = null;
  private turnStartTime: number | null = null;

  handleTurnStart(_payload: { turnId: string; sessionId: string }): void {
    this.turnStartTime = Date.now();
  }

  handleTurnEnd(payload: { turnId: string; status: string }): void {
    this.turnCount++;
    this.lastTurnStatus = payload.status;
    this.lastTurnTimestamp = Date.now();

    if (this.turnStartTime !== null) {
      this.lastTurnDuration = Date.now() - this.turnStartTime;
      this.turnStartTime = null;
    }

    if (payload.status === "errored") {
      this.consecutiveErrors++;
    } else {
      this.consecutiveErrors = 0;
    }
  }

  handleChainStart(_payload: { chainId: string; sessionId: string }): void {
    this.activeChains++;
  }

  handleChainEnd(_payload: { chainId: string; sessionId: string; status: string; turns: number }): void {
    this.activeChains = Math.max(0, this.activeChains - 1);
  }

  getMetrics(): MetricsSnapshot {
    return {
      turnCount: this.turnCount,
      activeChains: this.activeChains,
      lastTurnDuration: this.lastTurnDuration,
      lastTurnStatus: this.lastTurnStatus,
      consecutiveErrors: this.consecutiveErrors,
      lastTurnTimestamp: this.lastTurnTimestamp,
    };
  }
}

export function registerMetricsCollector(engine: HandlerEngine): MetricsCollector {
  const collector = new MetricsCollector();

  engine.observe("turn:start", async (payload: unknown) => {
    collector.handleTurnStart(payload as { turnId: string; sessionId: string });
    return { ok: true };
  }, 50, "metrics-collector:turn:start");

  engine.observe("turn:end", async (payload: unknown) => {
    collector.handleTurnEnd(payload as { turnId: string; status: string });
    return { ok: true };
  }, 50, "metrics-collector:turn:end");

  engine.observe("chain:start", async (payload: unknown) => {
    collector.handleChainStart(payload as { chainId: string; sessionId: string });
    return { ok: true };
  }, 50, "metrics-collector:chain:start");

  engine.observe("chain:end", async (payload: unknown) => {
    collector.handleChainEnd(payload as { chainId: string; sessionId: string; status: string; turns: number });
    return { ok: true };
  }, 50, "metrics-collector:chain:end");

  return collector;
}
