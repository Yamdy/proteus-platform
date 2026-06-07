// @proteus-ai/server — Status and config API routes

import type { FastifyInstance } from "fastify";
import type { MetricsCollector, LifecycleStateMachine, ConfigSnapshotManager } from "@proteus-ai/core";

export interface StatusRouteDeps {
  metrics?: MetricsCollector;
  lifecycle?: LifecycleStateMachine;
  configManager?: ConfigSnapshotManager;
  sessionId?: string;
}

export async function registerStatusRoutes(app: FastifyInstance, deps: StatusRouteDeps = {}): Promise<void> {
  const startTime = Date.now();
  let currentConfig: Record<string, unknown> = {
    level0: { llm: { provider: "deepseek", model: "deepseek-chat", temperature: 0.7 }, tools: [], logLevel: "info", systemPrompt: "You are a helpful AI assistant." },
    level1: { handlers: [
      { id: "context-assembly", name: "Context Assembly", priority: 100, enabled: true },
      { id: "llm-inference", name: "LLM Inference", priority: 200, enabled: true },
      { id: "action-resolution", name: "Action Resolution", priority: 300, enabled: true },
      { id: "tool-execution", name: "Tool Execution", priority: 400, enabled: true },
      { id: "result-observation", name: "Result Observation", priority: 500, enabled: true },
    ] },
    level2: { code: "", language: "typescript" },
  };

  app.get("/status", async () => ({
    lifecycle: deps.lifecycle?.state ?? "pending",
    uptime: Date.now() - startTime,
    metrics: deps.metrics?.getMetrics() ?? { turnCount: 0, activeChains: 0, lastTurnDuration: 0, lastTurnStatus: null, consecutiveErrors: 0, lastTurnTimestamp: null },
  }));

  app.get("/config", async () => currentConfig);

  app.post("/config", async (request) => {
    currentConfig = { ...currentConfig, ...(request.body ?? {}) };
    return currentConfig;
  });
}
