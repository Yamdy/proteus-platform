import type { TenantConfig } from "../types.js";
import { TenantContext } from "./tenant-context.js";

/**
 * TenantRegistry manages multiple TenantContext instances.
 *
 * Provides lookup by tenantId and global listing.
 */
export class TenantRegistry {
  private readonly tenants = new Map<string, TenantContext>();

  /**
   * Register a new tenant.
   */
  register(config: TenantConfig): TenantContext {
    if (this.tenants.has(config.tenantId)) {
      throw new Error(`Tenant "${config.tenantId}" is already registered`);
    }
    const tenant = new TenantContext(config);
    this.tenants.set(config.tenantId, tenant);
    return tenant;
  }

  /**
   * Unregister a tenant.
   */
  unregister(tenantId: string): void {
    this.tenants.delete(tenantId);
  }

  /**
   * Get a tenant by ID.
   */
  get(tenantId: string): TenantContext | undefined {
    return this.tenants.get(tenantId);
  }

  /**
   * Check if a tenant exists.
   */
  has(tenantId: string): boolean {
    return this.tenants.has(tenantId);
  }

  /**
   * List all tenant IDs.
   */
  list(): string[] {
    return [...this.tenants.keys()];
  }

  /**
   * Get total tenant count.
   */
  get size(): number {
    return this.tenants.size;
  }

  /**
   * Find which tenant owns a given agent ID.
   * Returns undefined if the agent is not registered in any tenant.
   */
  findTenantForAgent(agentId: string): TenantContext | undefined {
    for (const tenant of this.tenants.values()) {
      if (tenant.hasAgent(agentId)) {
        return tenant;
      }
    }
    return undefined;
  }
}
