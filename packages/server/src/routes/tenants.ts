// @proteus-ai/server — Tenant management and manifest run routes
//
// Provides:
// - POST /api/manifest/run — parse YAML manifest, compile, register agent
// - GET /api/tenants — list tenants
// - GET /api/tenants/:tenantId — get tenant details
// - GET /api/tenants/:tenantId/usage — get quota usage

import type { FastifyInstance } from "fastify";
import {
  TenantRegistry,
  QuotaManager,
  compileManifest,
  parseManifestYaml,
  HandlerEngine,
  AgentContext,
  registerBuiltins,
  registerBuiltInProcessors,
} from "@proteus-ai/core";
import type { LLMProvider, Tool, TenantConfig } from "@proteus-ai/core";
import { parse as yamlParse } from "yaml";

export interface TenantRouteDeps {
  tenantRegistry: TenantRegistry;
  quotaManager: QuotaManager;
  llmFactory?: (provider: string, model: string) => LLMProvider;
  toolRegistry?: Map<string, Tool>;
}

export async function registerTenantRoutes(
  app: FastifyInstance,
  deps: TenantRouteDeps,
): Promise<void> {
  const { tenantRegistry, quotaManager } = deps;

  // --- POST /manifest/run ---
  app.post<{ Body: { manifest: string; format?: "yaml" | "json" } }>(
    "/manifest/run",
    async (request, reply) => {
      const { manifest: manifestStr, format } = request.body ?? {};
      if (!manifestStr) {
        return reply.status(400).send({
          error: "Bad Request",
          message: "Body must include manifest (YAML or JSON string)",
        });
      }

      // Parse manifest
      const parseResult = format === "json"
        ? parseManifestYaml(manifestStr)
        : parseManifestYaml(manifestStr, yamlParse);

      if (!parseResult.ok) {
        return reply.status(400).send({
          error: "Bad Request",
          message: parseResult.reason,
        });
      }

      const config = parseResult.config;

      // Register tenant if needed
      let tenant = config.tenantId
        ? tenantRegistry.get(config.tenantId)
        : undefined;

      if (config.tenantId && !tenant) {
        const tenantConfig: TenantConfig = {
          tenantId: config.tenantId,
          name: config.manifest.name,
          quotas: config.quotas,
        };
        tenant = tenantRegistry.register(tenantConfig);
      }

      // Set quotas if tenant exists and quotas are defined
      if (tenant && config.quotas) {
        quotaManager.setQuotas(tenant.tenantId, config.quotas);
      }

      // Create AgentContext from compiled config
      const engine = new HandlerEngine();
      registerBuiltins(engine);
      registerBuiltInProcessors(engine);

      // Note: In a real deployment, the LLM provider would be resolved
      // from the manifest's llm.provider field using a provider registry.
      // For now, we use a stub if no factory is provided.
      const llm = deps.llmFactory
        ? deps.llmFactory(config.manifest.llm.provider, config.manifest.llm.model)
        : createStubLLM();

      const tools = new Map<string, Tool>();
      for (const toolName of config.enabledTools) {
        const tool = deps.toolRegistry?.get(toolName);
        if (tool) {
          tools.set(toolName, tool);
        }
      }

      const agent = new AgentContext({
        llm,
        tools,
        handlerEngine: engine,
      });

      // Register agent in tenant
      if (tenant) {
        tenant.registerAgent(config.manifest.name, agent);
      }

      return reply.send({
        ok: true,
        agentId: config.manifest.name,
        tenantId: config.tenantId,
        enabledTools: config.enabledTools,
        sessionId: config.sessionConfig.sessionId,
      });
    },
  );

  // --- GET /tenants ---
  app.get("/tenants", async (_request, reply) => {
    const tenants = tenantRegistry.list().map((id) => {
      const t = tenantRegistry.get(id)!;
      return {
        tenantId: t.tenantId,
        name: t.name,
        agentCount: t.agentCount,
        agents: t.listAgents(),
      };
    });

    return reply.send({ tenants });
  });

  // --- GET /tenants/:tenantId ---
  app.get<{ Params: { tenantId: string } }>(
    "/tenants/:tenantId",
    async (request, reply) => {
      const { tenantId } = request.params;
      const tenant = tenantRegistry.get(tenantId);

      if (!tenant) {
        return reply.status(404).send({
          error: "Not Found",
          message: `Tenant "${tenantId}" not found`,
        });
      }

      const quotas = quotaManager.getQuotas(tenantId);
      const usage = quotaManager.getUsage(tenantId);

      return reply.send({
        tenantId: tenant.tenantId,
        name: tenant.name,
        agents: tenant.listAgents(),
        agentCount: tenant.agentCount,
        quotas,
        usage,
      });
    },
  );

  // --- GET /tenants/:tenantId/usage ---
  app.get<{ Params: { tenantId: string } }>(
    "/tenants/:tenantId/usage",
    async (request, reply) => {
      const { tenantId } = request.params;

      if (!tenantRegistry.has(tenantId)) {
        return reply.status(404).send({
          error: "Not Found",
          message: `Tenant "${tenantId}" not found`,
        });
      }

      const usage = quotaManager.getUsage(tenantId);
      const quotaCheck = quotaManager.checkQuota(tenantId);

      return reply.send({
        usage,
        quotaStatus: {
          allowed: quotaCheck.allowed,
          reason: quotaCheck.reason,
        },
      });
    },
  );
}

// --- Stub LLM (used when no provider factory is configured) ---

function createStubLLM(): LLMProvider {
  return {
    chat: async () => ({
      content: "[stub] No LLM provider configured",
      usage: { promptTokens: 0, completionTokens: 0 },
      finishReason: "stop" as const,
    }),
    chatStream: async function* () {
      yield {
        content: "[stub] No LLM provider configured",
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: "stop" as const,
      };
    },
    countTokens: (text: string) => Math.ceil(text.length / 4),
  };
}
