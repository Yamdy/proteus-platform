import { describe, it, expect, beforeEach } from "vitest";
import { TenantContext } from "../packages/core/src/tenant/tenant-context.js";
import { QuotaManager } from "../packages/core/src/tenant/quota-manager.js";
import { TenantRegistry } from "../packages/core/src/tenant/tenant-registry.js";
import { compileManifest, parseManifestYaml } from "../packages/core/src/manifest/manifest-compiler.js";
import { AgentManifestSchema } from "../packages/core/src/manifest/manifest-schema.js";
import { CostAttributionTracker } from "../packages/core/src/cost-tracker.js";
import { AgentContext } from "../packages/core/src/context.js";

describe("Phase 6 E2E: Multi-Tenant + Manifest", () => {
  describe("Tenant isolation", () => {
    it("Tenant A's agents are invisible to Tenant B", () => {
      const registry = new TenantRegistry();
      const tA = registry.register({ tenantId: "tenant-a", name: "Tenant A" });
      const tB = registry.register({ tenantId: "tenant-b", name: "Tenant B" });

      tA.registerAgent("agent-a", makeStubAgent());
      tB.registerAgent("agent-b", makeStubAgent());

      expect(tA.hasAgent("agent-a")).toBe(true);
      expect(tA.listAgents()).toEqual(["agent-a"]);
      expect(tA.hasAgent("agent-b")).toBe(false);
      expect(tA.getAgent("agent-b")).toBeUndefined();
      expect(tB.hasAgent("agent-a")).toBe(false);
    });

    it("Registry can find which tenant owns an agent", () => {
      const registry = new TenantRegistry();
      const tA = registry.register({ tenantId: "tenant-a", name: "Tenant A" });
      const tB = registry.register({ tenantId: "tenant-b", name: "Tenant B" });

      tA.registerAgent("agent-a", makeStubAgent());
      tB.registerAgent("agent-b", makeStubAgent());

      expect(registry.findTenantForAgent("agent-a")?.tenantId).toBe("tenant-a");
      expect(registry.findTenantForAgent("agent-b")?.tenantId).toBe("tenant-b");
      expect(registry.findTenantForAgent("unknown")).toBeUndefined();
    });
  });

  describe("Quota enforcement per tenant", () => {
    let qm: QuotaManager;

    beforeEach(() => {
      qm = new QuotaManager();
      qm.setQuotas("tenant-a", { maxTokensPerPeriod: 1000, maxRequestsPerPeriod: 5, periodMs: 60_000 });
    });

    it("Allows requests within quota", () => {
      qm.recordTokens("tenant-a", 500);
      qm.recordRequest("tenant-a");
      expect(qm.checkQuota("tenant-a").allowed).toBe(true);
    });

    it("Denies when token quota exceeded", () => {
      qm.recordTokens("tenant-a", 1000);
      const check = qm.checkQuota("tenant-a");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Token quota exceeded");
    });

    it("Denies when request quota exceeded", () => {
      for (let i = 0; i < 5; i++) qm.recordRequest("tenant-a");
      const check = qm.checkQuota("tenant-a");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Request quota exceeded");
    });

    it("Quotas are isolated between tenants", () => {
      qm.setQuotas("tenant-b", { maxTokensPerPeriod: 5000 });
      qm.recordTokens("tenant-a", 1000);
      qm.recordTokens("tenant-b", 3000);
      expect(qm.checkQuota("tenant-a").allowed).toBe(false);
      expect(qm.checkQuota("tenant-b").allowed).toBe(true);
    });

    it("Integrates with CostAttributionTracker", () => {
      const costTracker = new CostAttributionTracker();
      const qmWithCost = new QuotaManager({ costTracker });
      costTracker.trackCost({ agentId: "agent-1", tokens: 100, cost: 0.01 });
      costTracker.trackCost({ agentId: "agent-2", tokens: 200, cost: 0.02 });
      expect(qmWithCost.getAgentCosts("tenant-a", ["agent-1", "agent-2"])).toBe(0.03);
    });
  });

  describe("Agent Manifest", () => {
    it("Validates and compiles a minimal manifest", () => {
      const result = compileManifest({
        name: "test-agent",
        llm: { provider: "deepseek", model: "deepseek-chat" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.manifest.name).toBe("test-agent");
      expect(result.config.sessionConfig.llm.provider).toBe("deepseek");
      expect(result.config.enabledTools).toEqual([]);
    });

    it("Compiles a full manifest with all features", () => {
      const result = compileManifest({
        name: "full-agent",
        llm: { provider: "openai", model: "gpt-4", temperature: 0.5 },
        tools: [{ name: "search", enabled: true }, { name: "disabled", enabled: false }],
        governance: { hooks: [{ hook: "H1" }, { hook: "H2" }], auditLog: true },
        quota: { maxTokensPerPeriod: 100000, periodSeconds: 3600 },
        tenantId: "tenant-1",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.enabledTools).toEqual(["search"]);
      expect(result.config.governanceHooks).toHaveLength(2);
      expect(result.config.auditLogEnabled).toBe(true);
      expect(result.config.quotas?.periodMs).toBe(3_600_000);
      expect(result.config.tenantId).toBe("tenant-1");
    });

    it("Rejects invalid manifest", () => {
      expect(compileManifest({ foo: "bar" }).ok).toBe(false);
      expect(compileManifest({ name: "test" }).ok).toBe(false);
    });

    it("Parses YAML via custom parser", () => {
      const result = parseManifestYaml("name: yaml-agent", () => ({
        name: "yaml-agent",
        llm: { provider: "deepseek", model: "deepseek-chat" },
      }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.config.manifest.name).toBe("yaml-agent");
    });
  });

  describe("End-to-end: manifest → tenant → quota", () => {
    it("Complete flow: parse manifest, create tenant, check quota", () => {
      const compileResult = compileManifest({
        name: "e2e-agent",
        llm: { provider: "deepseek", model: "deepseek-chat" },
        tenantId: "e2e-tenant",
        quota: { maxTokensPerPeriod: 5000, maxRequestsPerPeriod: 10, periodSeconds: 3600 },
      });
      expect(compileResult.ok).toBe(true);
      if (!compileResult.ok) return;

      const config = compileResult.config;
      const registry = new TenantRegistry();
      const tenant = registry.register({
        tenantId: config.tenantId!,
        name: config.manifest.name,
        quotas: config.quotas,
      });

      const qm = new QuotaManager();
      qm.setQuotas(tenant.tenantId, config.quotas!);
      tenant.registerAgent("e2e-agent", makeStubAgent());

      expect(tenant.hasAgent("e2e-agent")).toBe(true);
      expect(tenant.agentCount).toBe(1);
      expect(qm.checkQuota("e2e-tenant").allowed).toBe(true);

      qm.recordTokens("e2e-tenant", 5000);
      const check = qm.checkQuota("e2e-tenant");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Token quota exceeded");
    });
  });
});

function makeStubAgent(): AgentContext {
  return new AgentContext({
    llm: {
      chat: async () => ({ content: "", usage: { promptTokens: 0, completionTokens: 0 }, finishReason: "stop" as const }),
      chatStream: async function* () {},
      countTokens: () => 0,
    },
    tools: new Map(),
  });
}
