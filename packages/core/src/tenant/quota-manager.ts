import type { TenantQuotas, QuotaUsage, QuotaCheckResult } from "../types.js";
import type { CostAttributionTracker } from "../cost-tracker.js";

interface TenantUsageRecord {
  tokensUsed: number;
  requestsUsed: number;
  costUsed: number;
  periodStart: number;
}

/**
 * QuotaManager tracks and enforces per-tenant resource quotas.
 *
 * Integrates with CostAttributionTracker for cost accounting.
 * Usage resets each period (sliding window).
 */
export class QuotaManager {
  private readonly tenantQuotas = new Map<string, TenantQuotas>();
  private readonly tenantUsage = new Map<string, TenantUsageRecord>();
  private readonly costTracker?: CostAttributionTracker;

  constructor(params?: { costTracker?: CostAttributionTracker }) {
    this.costTracker = params?.costTracker;
  }

  /**
   * Set or update quotas for a tenant.
   */
  setQuotas(tenantId: string, quotas: TenantQuotas): void {
    this.tenantQuotas.set(tenantId, { ...quotas });
  }

  /**
   * Get the configured quotas for a tenant.
   */
  getQuotas(tenantId: string): TenantQuotas | undefined {
    return this.tenantQuotas.get(tenantId);
  }

  /**
   * Remove quotas for a tenant.
   */
  removeQuotas(tenantId: string): void {
    this.tenantQuotas.delete(tenantId);
    this.tenantUsage.delete(tenantId);
  }

  /**
   * Check if a request is allowed under the tenant's quotas.
   *
   * Returns { allowed: true } if within limits, or { allowed: false, reason }
   * if a quota would be exceeded.
   */
  checkQuota(tenantId: string): QuotaCheckResult {
    const usage = this.getUsage(tenantId);
    const quotas = this.tenantQuotas.get(tenantId);

    if (!quotas) {
      return { allowed: true, usage };
    }

    // Check token quota
    if (quotas.maxTokensPerPeriod !== undefined) {
      if (usage.tokensUsed >= quotas.maxTokensPerPeriod) {
        return {
          allowed: false,
          reason: `Token quota exceeded: ${usage.tokensUsed}/${quotas.maxTokensPerPeriod} in this period`,
          usage,
        };
      }
    }

    // Check request quota
    if (quotas.maxRequestsPerPeriod !== undefined) {
      if (usage.requestsUsed >= quotas.maxRequestsPerPeriod) {
        return {
          allowed: false,
          reason: `Request quota exceeded: ${usage.requestsUsed}/${quotas.maxRequestsPerPeriod} in this period`,
          usage,
        };
      }
    }

    // Check cost quota
    if (quotas.maxCostPerPeriod !== undefined) {
      if (usage.costUsed >= quotas.maxCostPerPeriod) {
        return {
          allowed: false,
          reason: `Cost quota exceeded: $${usage.costUsed.toFixed(4)}/$${quotas.maxCostPerPeriod} in this period`,
          usage,
        };
      }
    }

    return { allowed: true, usage };
  }

  /**
   * Record token usage for a tenant.
   */
  recordTokens(tenantId: string, tokens: number): void {
    const record = this.getOrCreateRecord(tenantId);
    record.tokensUsed += tokens;
  }

  /**
   * Record a request for a tenant.
   */
  recordRequest(tenantId: string): void {
    const record = this.getOrCreateRecord(tenantId);
    record.requestsUsed += 1;
  }

  /**
   * Record cost for a tenant (in USD).
   */
  recordCost(tenantId: string, cost: number): void {
    const record = this.getOrCreateRecord(tenantId);
    record.costUsed += cost;
  }

  /**
   * Get current usage for a tenant.
   */
  getUsage(tenantId: string): QuotaUsage {
    const record = this.getOrCreateRecord(tenantId);
    const quotas = this.tenantQuotas.get(tenantId);
    const periodMs = quotas?.periodMs ?? 3_600_000; // default 1 hour

    return {
      tenantId,
      tokensUsed: record.tokensUsed,
      requestsUsed: record.requestsUsed,
      costUsed: record.costUsed,
      periodStart: record.periodStart,
      periodEnd: record.periodStart + periodMs,
    };
  }

  /**
   * Reset usage for a tenant (e.g., on period boundary).
   */
  resetUsage(tenantId: string): void {
    this.tenantUsage.delete(tenantId);
  }

  /**
   * Get cost from CostAttributionTracker for agents belonging to a tenant.
   * This is a convenience method that aggregates costs from the tracker.
   */
  getAgentCosts(tenantId: string, agentIds: string[]): number {
    if (!this.costTracker) return 0;
    let total = 0;
    for (const agentId of agentIds) {
      total += this.costTracker.getTotalCost(agentId);
    }
    return total;
  }

  // --- Private ---

  private getOrCreateRecord(tenantId: string): TenantUsageRecord {
    let record = this.tenantUsage.get(tenantId);
    if (!record) {
      const quotas = this.tenantQuotas.get(tenantId);
      const periodMs = quotas?.periodMs ?? 3_600_000;
      const now = Date.now();
      record = {
        tokensUsed: 0,
        requestsUsed: 0,
        costUsed: 0,
        periodStart: now - (now % periodMs), // align to period boundary
      };
      this.tenantUsage.set(tenantId, record);
    }

    // Check if period has rolled over
    const quotas = this.tenantQuotas.get(tenantId);
    const periodMs = quotas?.periodMs ?? 3_600_000;
    const now = Date.now();
    if (now >= record.periodStart + periodMs) {
      // Reset for new period
      record.tokensUsed = 0;
      record.requestsUsed = 0;
      record.costUsed = 0;
      record.periodStart = now - (now % periodMs);
    }

    return record;
  }
}
