// @proteus-ai/server — Fastify server implementation

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import {
  SessionManager,
  createInMemoryStore,
  InMemoryCheckpointLog,
  Harness,
  AgentContext,
  HandlerEngine,
  registerBuiltins,
  registerBuiltInProcessors,
  TenantRegistry,
  QuotaManager,
} from "@proteus-ai/core";
import type {
  MetricsCollector,
  CostStore,
  EventLog,
  SessionStore,
  LifecycleStateMachine,
  ConfigSnapshotManager,
  LLMProvider,
  Tool,
  CheckpointLog,
} from "@proteus-ai/core";
import { sessionRoutes } from "./routes/sessions.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerStatusRoutes, type StatusRouteDeps } from "./routes/status.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerWsRoutes, EventBus } from "./routes/ws.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  cors?: boolean;
  store?: SessionStore;
  sessionStore?: SessionStore;
  metrics?: MetricsCollector;
  costStore?: CostStore;
  eventLog?: EventLog;
  handlerCount?: number;
  lifecycle?: LifecycleStateMachine;
  configManager?: ConfigSnapshotManager;
  sessionId?: string;
  checkpointLog?: CheckpointLog;
  llm?: LLMProvider;
  tools?: Map<string, Tool>;
  eventBus?: EventBus;
}

export class ProteusServer {
  private app: FastifyInstance;
  private port: number;
  private host: string;
  private readonly _sessionManager: SessionManager;
  private readonly _harness: Harness;
  private readonly _agent?: AgentContext;
  private readonly _tenantRegistry: TenantRegistry;
  private readonly _quotaManager: QuotaManager;

  constructor(options: ServerOptions = {}) {
    this.port = options.port ?? 3000;
    this.host = options.host ?? "0.0.0.0";

    this.app = Fastify({ logger: true });

    if (options.cors !== false) {
      this.app.register(cors);
    }
    this.app.register(websocket);

    this._sessionManager = new SessionManager({
      store: options.store ?? createInMemoryStore(),
    });

    this._harness = new Harness({
      store: options.checkpointLog ?? new InMemoryCheckpointLog(),
    });

    this._tenantRegistry = new TenantRegistry();
    this._quotaManager = new QuotaManager();

    if (options.llm) {
      const engine = new HandlerEngine();
      registerBuiltins(engine);
      registerBuiltInProcessors(engine);
      this._agent = new AgentContext({
        llm: options.llm,
        tools: options.tools ?? new Map(),
        handlerEngine: engine,
      });
    }

    this.registerRoutes(options);
  }

  get sessionManager(): SessionManager { return this._sessionManager; }
  get harness(): Harness { return this._harness; }
  get tenantRegistry(): TenantRegistry { return this._tenantRegistry; }
  get quotaManager(): QuotaManager { return this._quotaManager; }

  private registerRoutes(options: ServerOptions): void {
    this.app.get("/health", async () => ({
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
    }));

    this.app.register(async (api) => {
      api.register(sessionRoutes, {
        prefix: "/sessions",
        sessionManager: this._sessionManager,
        harness: this._harness,
        agent: this._agent,
      });

      const statusDeps: StatusRouteDeps = {
        metrics: options.metrics,
        lifecycle: options.lifecycle,
        configManager: options.configManager,
        sessionId: options.sessionId,
      };
      api.register(async (app) => registerStatusRoutes(app, statusDeps));

      if (this._agent) {
        api.register(
          (app) => registerChatRoutes(app, {
            sessionManager: this._sessionManager,
            harness: this._harness,
            agent: this._agent!,
          }),
          { prefix: "/chat" },
        );
      }

      api.register(registerMetricsRoutes, {
        metrics: options.metrics,
        costStore: options.costStore,
        eventLog: options.eventLog,
        sessionStore: options.sessionStore,
        handlerCount: options.handlerCount,
      });

      api.register(
        (app) => registerTenantRoutes(app, {
          tenantRegistry: this._tenantRegistry,
          quotaManager: this._quotaManager,
        }),
      );
    }, { prefix: "/api" });

    const eventBus = options.eventBus ?? new EventBus(options.eventLog);
    this.app.register(async (app) => registerWsRoutes(app, { eventBus }));
  }

  async start(): Promise<void> {
    await this.app.listen({ port: this.port, host: this.host });
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  get instance(): FastifyInstance { return this.app; }
}

export function createServer(options?: ServerOptions): ProteusServer {
  return new ProteusServer(options);
}
