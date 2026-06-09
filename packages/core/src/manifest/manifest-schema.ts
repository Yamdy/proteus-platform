// @proteus-ai/core — Agent Manifest Zod Schema
//
// Defines the YAML format for declarative Agent configuration.
// The Manifest Compiler transforms this into runtime config (AgentContext + SessionConfig).

import { z } from "zod";

// --- LLM Configuration ---

export const ManifestLLMSchema = z.object({
  provider: z.string().describe("LLM provider name (e.g. 'deepseek', 'openai')"),
  model: z.string().describe("Model identifier (e.g. 'deepseek-chat', 'gpt-4')"),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().positive().optional(),
  systemPrompt: z.string().optional().describe("System prompt template"),
});

export type ManifestLLM = z.infer<typeof ManifestLLMSchema>;

// --- Tool Configuration ---

export const ManifestToolSchema = z.object({
  name: z.string(),
  enabled: z.boolean().optional().default(true),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ManifestTool = z.infer<typeof ManifestToolSchema>;

// --- Governance Configuration ---

export const ManifestGovernanceHookSchema = z.object({
  /** Hook identifier: H1, H2, H3, or H4 */
  hook: z.enum(["H1", "H2", "H3", "H4"]),
  /** Whether this hook is enabled */
  enabled: z.boolean().optional().default(true),
  /** Policy type (e.g. 'allow-all', 'deny-list', 'owner-only-write') */
  policy: z.string().optional(),
  /** Policy-specific configuration */
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ManifestGovernanceHook = z.infer<typeof ManifestGovernanceHookSchema>;

export const ManifestGovernanceSchema = z.object({
  hooks: z.array(ManifestGovernanceHookSchema).optional(),
  auditLog: z.boolean().optional().default(false),
});

export type ManifestGovernance = z.infer<typeof ManifestGovernanceSchema>;

// --- Memory Configuration ---

export const ManifestMemorySchema = z.object({
  enabled: z.boolean().optional().default(true),
  /** Max messages to keep in conversation history */
  maxMessages: z.number().positive().optional().default(50),
  /** Enable semantic recall (vector search) */
  semanticRecall: z.boolean().optional().default(false),
  /** Enable structured working memory */
  structuredMemory: z.boolean().optional().default(false),
});

export type ManifestMemory = z.infer<typeof ManifestMemorySchema>;

// --- Knowledge Configuration ---

export const ManifestKnowledgeSchema = z.object({
  /** Knowledge access policy type */
  policy: z.enum(["allow-all", "owner-only-write", "deny-tags"]).optional().default("allow-all"),
  /** Tags to deny (when policy is 'deny-tags') */
  deniedTags: z.array(z.string()).optional(),
});

export type ManifestKnowledge = z.infer<typeof ManifestKnowledgeSchema>;

// --- Quota Configuration ---

export const ManifestQuotaSchema = z.object({
  maxTokensPerPeriod: z.number().positive().optional(),
  maxRequestsPerPeriod: z.number().positive().optional(),
  /** Period duration in seconds (converted to ms internally) */
  periodSeconds: z.number().positive().optional(),
  maxConcurrentSessions: z.number().positive().optional(),
  maxCostPerPeriod: z.number().positive().optional(),
});

export type ManifestQuota = z.infer<typeof ManifestQuotaSchema>;

// --- MCP Server Configuration ---

export const ManifestMcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "sse"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
});

export type ManifestMcpServer = z.infer<typeof ManifestMcpServerSchema>;

// --- Agent Manifest (top-level) ---

export const AgentManifestSchema = z.object({
  /** API version for forward compatibility */
  apiVersion: z.string().optional().default("v1"),
  /** Agent kind (currently only 'agent') */
  kind: z.string().optional().default("agent"),

  /** Agent metadata */
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().optional().default("0.1.0"),
  tags: z.array(z.string()).optional().default([]),

  /** LLM configuration */
  llm: ManifestLLMSchema,

  /** Tools to register */
  tools: z.array(ManifestToolSchema).optional().default([]),

  /** MCP servers to connect */
  mcpServers: z.array(ManifestMcpServerSchema).optional().default([]),

  /** Governance hooks */
  governance: ManifestGovernanceSchema.optional(),

  /** Memory configuration */
  memory: ManifestMemorySchema.optional(),

  /** Knowledge access policy */
  knowledge: ManifestKnowledgeSchema.optional(),

  /** Resource quotas (for multi-tenant) */
  quota: ManifestQuotaSchema.optional(),

  /** Tenant ID (for multi-tenant deployments) */
  tenantId: z.string().optional(),
});

export type AgentManifest = z.infer<typeof AgentManifestSchema>;
