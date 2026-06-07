import type { AgentContext } from "./context.js";

/**
 * Registry of agents by ID. Used by AgentRouter to resolve delegation targets.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentContext>();

  register(agentId: string, agent: AgentContext): void {
    if (this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" is already registered`);
    }
    this.agents.set(agentId, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  get(agentId: string): AgentContext | undefined {
    return this.agents.get(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  list(): string[] {
    return [...this.agents.keys()];
  }
}
