// @proteus-ai/core — Manifest Compiler
//
// Transforms an AgentManifest (parsed YAML/JSON) into runtime configuration.
// Does NOT create AgentContext directly — that requires IO dependencies (LLM provider, tools).
// Instead, produces a CompiledAgentConfig that the caller uses to wire up runtime objects.

import type { AgentManifest } from "./manifest-schema.js";
import { AgentManifestSchema } from "./manifest-schema.js";
import type { SessionConfig, GovernanceHookName, TenantQuotas } from "../types.js";

// --- Compiled Output ---

export interface CompiledAgentConfig {
  /** Validated and defaulted manifest */
  manifest: AgentManifest;
  /** SessionConfig derived from manifest */
  sessionConfig: SessionConfig;
  /** Tool names that should be registered (enabled only) */
  enabledTools: string[];
  /** Governance hooks configuration */
  governanceHooks: CompiledGovernanceHook[];
  /** Whether audit logging is enabled */
  auditLogEnabled: boolean;
  /** Tenant quotas derived from manifest */
  quotas?: TenantQuotas;
  /** Tenant ID if specified */
  tenantId?: string;
}

export interface CompiledGovernanceHook {
  hook: GovernanceHookName;
  enabled: boolean;
  policy?: string;
  config?: Record<string, unknown>;
}

// --- Compiler Result ---

export type CompileResult =
  | { ok: true; config: CompiledAgentConfig }
  | { ok: false; reason: string };

// --- Compiler ---

/**
 * Compile an AgentManifest into runtime configuration.
 *
 * Steps:
 * 1. Validate manifest against Zod schema
 * 2. Extract SessionConfig
 * 3. Extract enabled tool names
 * 4. Extract governance hooks
 * 5. Extract tenant quotas
 */
export function compileManifest(input: unknown): CompileResult {
  // Step 1: Validate
  const parsed = AgentManifestSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `Invalid manifest: ${errors}` };
  }

  const manifest = parsed.data;

  // Step 2: SessionConfig
  const sessionConfig: SessionConfig = {
    sessionId: `manifest-${manifest.name}-${Date.now()}`,
    llm: {
      provider: manifest.llm.provider,
      model: manifest.llm.model,
      temperature: manifest.llm.temperature ?? 0.7,
    },
    tools: Object.fromEntries(
      manifest.tools.map((t) => [t.name, t.enabled !== false]),
    ),
    logLevel: "info",
    name: manifest.name,
    createdAt: Date.now(),
  };

  // Step 3: Enabled tools
  const enabledTools = manifest.tools
    .filter((t) => t.enabled !== false)
    .map((t) => t.name);

  // Step 4: Governance hooks
  const governanceHooks: CompiledGovernanceHook[] = (
    manifest.governance?.hooks ?? []
  ).map((h) => ({
    hook: h.hook,
    enabled: h.enabled !== false,
    policy: h.policy,
    config: h.config,
  }));

  const auditLogEnabled = manifest.governance?.auditLog ?? false;

  // Step 5: Tenant quotas
  let quotas: TenantQuotas | undefined;
  if (manifest.quota) {
    quotas = {
      maxTokensPerPeriod: manifest.quota.maxTokensPerPeriod,
      maxRequestsPerPeriod: manifest.quota.maxRequestsPerPeriod,
      periodMs: manifest.quota.periodSeconds
        ? manifest.quota.periodSeconds * 1000
        : undefined,
      maxConcurrentSessions: manifest.quota.maxConcurrentSessions,
      maxCostPerPeriod: manifest.quota.maxCostPerPeriod,
    };
  }

  return {
    ok: true,
    config: {
      manifest,
      sessionConfig,
      enabledTools,
      governanceHooks,
      auditLogEnabled,
      quotas,
      tenantId: manifest.tenantId,
    },
  };
}

/**
 * Parse a YAML string into an AgentManifest.
 *
 * Note: This function requires a YAML parser to be provided by the caller
 * (to keep core IO-free). The Server layer provides the actual parser.
 *
 * If no parser is provided, attempts JSON.parse as fallback.
 */
export function parseManifestYaml(
  yamlString: string,
  yamlParser?: (input: string) => unknown,
): CompileResult {
  let parsed: unknown;

  try {
    if (yamlParser) {
      parsed = yamlParser(yamlString);
    } else {
      // Fallback: try JSON parse
      parsed = JSON.parse(yamlString);
    }
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to parse manifest: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return compileManifest(parsed);
}
