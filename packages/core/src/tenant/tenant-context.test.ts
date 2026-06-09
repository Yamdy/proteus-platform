import { describe, it, expect } from "vitest";
import { TenantContext } from "./tenant-context.js";
import { AgentContext } from "../context.js";

function makeAgent(): AgentContext {
  return new AgentContext({
    llm: {
      chat: async () => ({
        content: "",
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: "stop" as const,
      }),
      chatStream: async function* () {},
      countTokens: () => 0,
    },
    tools: new Map(),
  });
}

describe("TenantContext", () => {
  it("should create a tenant from config", () => {
    const tenant = new TenantContext({
      tenantId: "t1",
      name: "Tenant One",
    });

    expect(tenant.tenantId).toBe("t1");
    expect(tenant.name).toBe("Tenant One");
    expect(tenant.quotas).toEqual({});
    expect(tenant.metadata).toEqual({});
  });

  it("should create a tenant with quotas", () => {
    const tenant = new TenantContext({
      tenantId: "t1",
      name: "Tenant One",
      quotas: {
        maxTokensPerPeriod: 100_000,
        maxRequestsPerPeriod: 100,
        periodMs: 3_600_000,
      },
    });

    expect(tenant.quotas.maxTokensPerPeriod).toBe(100_000);
    expect(tenant.quotas.maxRequestsPerPeriod).toBe(100);
  });

  it("should register and retrieve agents", () => {
    const tenant = new TenantContext({ tenantId: "t1", name: "T1" });
    const agent = makeAgent();

    tenant.registerAgent("agent-1", agent);

    expect(tenant.hasAgent("agent-1")).toBe(true);
    expect(tenant.getAgent("agent-1")).toBe(agent);
    expect(tenant.listAgents()).toEqual(["agent-1"]);
    expect(tenant.agentCount).toBe(1);
  });

  it("should throw on duplicate agent registration", () => {
    const tenant = new TenantContext({ tenantId: "t1", name: "T1" });
    const agent = makeAgent();

    tenant.registerAgent("agent-1", agent);
    expect(() => tenant.registerAgent("agent-1", agent)).toThrow(
      'Agent "agent-1" already registered in tenant "t1"',
    );
  });

  it("should unregister agents", () => {
    const tenant = new TenantContext({ tenantId: "t1", name: "T1" });
    const agent = makeAgent();

    tenant.registerAgent("agent-1", agent);
    tenant.unregisterAgent("agent-1");

    expect(tenant.hasAgent("agent-1")).toBe(false);
    expect(tenant.agentCount).toBe(0);
  });

  it("should return undefined for unknown agent", () => {
    const tenant = new TenantContext({ tenantId: "t1", name: "T1" });

    expect(tenant.getAgent("unknown")).toBeUndefined();
    expect(tenant.hasAgent("unknown")).toBe(false);
  });

  it("should support metadata", () => {
    const tenant = new TenantContext({
      tenantId: "t1",
      name: "T1",
      metadata: { region: "us-east-1", tier: "premium" },
    });

    expect(tenant.metadata.region).toBe("us-east-1");
    expect(tenant.metadata.tier).toBe("premium");
  });
});
