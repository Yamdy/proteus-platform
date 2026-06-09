import type { AgentContext } from "../context.js";
import type { TenantConfig, TenantQuotas } from "../types.js";

/**
 * TenantContext provides tenant isolation above AgentContext.
 *
 * Each tenant has its own config, quota limits, and a set of agents.
 * Tenant A's agents cannot access Tenant B's data.
 */
export class TenantContext {
  readonly tenantId: string;
  readonly name: string;
  readonly quotas: TenantQuotas;
  readonly metadata: Record<string, unknown>;

  private readonly agents = new Map<string, AgentContext>();

  constructor(config: TenantConfig) {
    this.tenantId = config.tenantId;
    this.name = config.name;
    this.quotas = config.quotas ?? {};
    this.metadata = config.metadata ?? {};
  }

  /**
   * Register an agent under this tenant.
   */
  registerAgent(agentId: string, agent: AgentContext): void {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" already registered in tenant "${this.tenantId}"`);
    }
    this.agents.set(agentId, agent);
  }

  /**
   * Unregister an agent from this tenant.
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /**
   * Get an agent by ID within this tenant.
   */
  getAgent(agentId: string): AgentContext | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Check if an agent belongs to this tenant.
   */
  hasAgent(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * List all agent IDs in this tenant.
   */
  listAgents(): string[] {
    return [...this.agents.keys()];
  }

  /**
   * Get agent count.
   */
  get agentCount(): number {
    return this.agents.size;
  }
}
