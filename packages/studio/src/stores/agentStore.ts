import { create } from "zustand";

export interface AgentInfo {
  agentId: string;
  tenantId?: string;
  tools: string[];
  status: "idle" | "running" | "error";
  sessionId?: string;
}

export interface TenantInfo {
  tenantId: string;
  name: string;
  agentCount: number;
  agents: string[];
  quotas?: {
    maxTokensPerPeriod?: number;
    maxRequestsPerPeriod?: number;
    maxCostPerPeriod?: number;
  };
  usage?: {
    tokensUsed: number;
    requestsUsed: number;
    costUsed: number;
    periodStart: number;
    periodEnd: number;
  };
}

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  agentId: string;
  startTime: number;
  endTime?: number;
  status: "ok" | "error" | "running";
  attributes?: Record<string, unknown>;
  children: TraceSpan[];
}

interface AgentState {
  agents: AgentInfo[];
  tenants: TenantInfo[];
  traceTree: TraceSpan | null;
  selectedAgentId: string | null;
  selectedTenantId: string | null;

  setAgents: (agents: AgentInfo[]) => void;
  addAgent: (agent: AgentInfo) => void;
  updateAgent: (agentId: string, patch: Partial<AgentInfo>) => void;
  setTenants: (tenants: TenantInfo[]) => void;
  setTraceTree: (tree: TraceSpan | null) => void;
  selectAgent: (agentId: string | null) => void;
  selectTenant: (tenantId: string | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  tenants: [],
  traceTree: null,
  selectedAgentId: null,
  selectedTenantId: null,

  setAgents: (agents) => set({ agents }),

  addAgent: (agent) =>
    set((state) => ({ agents: [...state.agents, agent] })),

  updateAgent: (agentId, patch) =>
    set((state) => ({
      agents: state.agents.map((a) =>
        a.agentId === agentId ? { ...a, ...patch } : a,
      ),
    })),

  setTenants: (tenants) => set({ tenants }),

  setTraceTree: (tree) => set({ traceTree: tree }),

  selectAgent: (agentId) => set({ selectedAgentId: agentId }),

  selectTenant: (tenantId) => set({ selectedTenantId: tenantId }),
}));
