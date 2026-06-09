import { describe, it, expect } from "vitest";
import { QuotaManager } from "./quota-manager.js";
import { CostAttributionTracker } from "../cost-tracker.js";

describe("QuotaManager", () => {
  it("should allow requests when no quotas are set", () => {
    const qm = new QuotaManager();

    const result = qm.checkQuota("tenant-1");

    expect(result.allowed).toBe(true);
  });

  it("should allow requests within token quota", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 1000 });

    qm.recordTokens("tenant-1", 500);
    const result = qm.checkQuota("tenant-1");

    expect(result.allowed).toBe(true);
    expect(result.usage.tokensUsed).toBe(500);
  });

  it("should deny requests when token quota exceeded", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 1000 });

    qm.recordTokens("tenant-1", 1000);
    const result = qm.checkQuota("tenant-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Token quota exceeded");
  });

  it("should deny requests when request quota exceeded", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { maxRequestsPerPeriod: 2 });

    qm.recordRequest("tenant-1");
    qm.recordRequest("tenant-1");
    const result = qm.checkQuota("tenant-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Request quota exceeded");
  });

  it("should deny requests when cost quota exceeded", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { maxCostPerPeriod: 1.0 });

    qm.recordCost("tenant-1", 1.0);
    const result = qm.checkQuota("tenant-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cost quota exceeded");
  });

  it("should track usage across multiple dimensions", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", {
      maxTokensPerPeriod: 10_000,
      maxRequestsPerPeriod: 100,
      maxCostPerPeriod: 5.0,
    });

    qm.recordTokens("tenant-1", 5000);
    qm.recordRequest("tenant-1");
    qm.recordCost("tenant-1", 2.5);

    const usage = qm.getUsage("tenant-1");

    expect(usage.tenantId).toBe("tenant-1");
    expect(usage.tokensUsed).toBe(5000);
    expect(usage.requestsUsed).toBe(1);
    expect(usage.costUsed).toBe(2.5);
  });

  it("should reset usage", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 1000 });

    qm.recordTokens("tenant-1", 500);
    qm.resetUsage("tenant-1");

    const usage = qm.getUsage("tenant-1");
    expect(usage.tokensUsed).toBe(0);
  });

  it("should update quotas", () => {
    const qm = new QuotaManager();

    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 1000 });
    expect(qm.getQuotas("tenant-1")?.maxTokensPerPeriod).toBe(1000);

    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 2000 });
    expect(qm.getQuotas("tenant-1")?.maxTokensPerPeriod).toBe(2000);
  });

  it("should remove quotas", () => {
    const qm = new QuotaManager();

    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 1000 });
    qm.removeQuotas("tenant-1");

    expect(qm.getQuotas("tenant-1")).toBeUndefined();
  });

  it("should isolate quotas between tenants", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { maxTokensPerPeriod: 1000 });
    qm.setQuotas("tenant-2", { maxTokensPerPeriod: 500 });

    qm.recordTokens("tenant-1", 800);
    qm.recordTokens("tenant-2", 500);

    expect(qm.checkQuota("tenant-1").allowed).toBe(true);
    expect(qm.checkQuota("tenant-2").allowed).toBe(false);
  });

  it("should integrate with CostAttributionTracker", () => {
    const costTracker = new CostAttributionTracker();
    const qm = new QuotaManager({ costTracker });

    costTracker.trackCost({
      agentId: "agent-1",
      tokens: 100,
      cost: 0.01,
    });
    costTracker.trackCost({
      agentId: "agent-2",
      tokens: 200,
      cost: 0.02,
    });

    const total = qm.getAgentCosts("tenant-1", ["agent-1", "agent-2"]);
    expect(total).toBe(0.03);
  });

  it("should return period boundaries in usage", () => {
    const qm = new QuotaManager();
    qm.setQuotas("tenant-1", { periodMs: 60_000 });

    const usage = qm.getUsage("tenant-1");

    expect(usage.periodEnd - usage.periodStart).toBe(60_000);
  });
});
