import { describe, it, expect } from "vitest";
import { AgentManifestSchema } from "./manifest-schema.js";

describe("AgentManifestSchema", () => {
  const validManifest = {
    name: "test-agent",
    llm: {
      provider: "deepseek",
      model: "deepseek-chat",
    },
  };

  it("should parse a minimal manifest", () => {
    const result = AgentManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("test-agent");
      expect(result.data.apiVersion).toBe("v1");
      expect(result.data.kind).toBe("agent");
      expect(result.data.version).toBe("0.1.0");
      expect(result.data.tools).toEqual([]);
      expect(result.data.tags).toEqual([]);
    }
  });

  it("should parse a full manifest", () => {
    const full = {
      apiVersion: "v1",
      kind: "agent",
      name: "my-agent",
      description: "A test agent",
      version: "1.0.0",
      tags: ["test", "demo"],
      llm: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.5,
        maxTokens: 4096,
        systemPrompt: "You are a helpful assistant.",
      },
      tools: [
        { name: "search", enabled: true },
        { name: "calculator", enabled: false, config: { precision: 10 } },
      ],
      mcpServers: [
        {
          name: "github",
          transport: "sse" as const,
          url: "https://mcp.github.com",
        },
      ],
      governance: {
        hooks: [
          { hook: "H1" as const, enabled: true, policy: "allow-all" },
          { hook: "H2" as const, enabled: true, policy: "deny-list", config: { deny: ["rm"] } },
        ],
        auditLog: true,
      },
      memory: {
        enabled: true,
        maxMessages: 100,
        semanticRecall: true,
        structuredMemory: true,
      },
      knowledge: {
        policy: "deny-tags" as const,
        deniedTags: ["internal", "secret"],
      },
      quota: {
        maxTokensPerPeriod: 100000,
        maxRequestsPerPeriod: 100,
        periodSeconds: 3600,
        maxConcurrentSessions: 5,
        maxCostPerPeriod: 10.0,
      },
      tenantId: "tenant-1",
    };

    const result = AgentManifestSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("my-agent");
      expect(result.data.tools).toHaveLength(2);
      expect(result.data.mcpServers).toHaveLength(1);
      expect(result.data.governance?.hooks).toHaveLength(2);
      expect(result.data.governance?.auditLog).toBe(true);
      expect(result.data.memory?.semanticRecall).toBe(true);
      expect(result.data.knowledge?.deniedTags).toEqual(["internal", "secret"]);
      expect(result.data.quota?.maxTokensPerPeriod).toBe(100000);
      expect(result.data.tenantId).toBe("tenant-1");
    }
  });

  it("should reject manifest without name", () => {
    const result = AgentManifestSchema.safeParse({
      llm: { provider: "openai", model: "gpt-4" },
    });
    expect(result.success).toBe(false);
  });

  it("should reject manifest without llm", () => {
    const result = AgentManifestSchema.safeParse({
      name: "test",
    });
    expect(result.success).toBe(false);
  });

  it("should reject empty name", () => {
    const result = AgentManifestSchema.safeParse({
      name: "",
      llm: { provider: "openai", model: "gpt-4" },
    });
    expect(result.success).toBe(false);
  });

  it("should reject temperature out of range", () => {
    const result = AgentManifestSchema.safeParse({
      name: "test",
      llm: { provider: "openai", model: "gpt-4", temperature: 3.0 },
    });
    expect(result.success).toBe(false);
  });

  it("should apply defaults for optional fields", () => {
    const result = AgentManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm.temperature).toBe(0.7);
      expect(result.data.tools).toEqual([]);
      expect(result.data.mcpServers).toEqual([]);
      expect(result.data.governance).toBeUndefined();
      expect(result.data.memory).toBeUndefined();
    }
  });

  it("should validate tool enabled default", () => {
    const result = AgentManifestSchema.safeParse({
      name: "test",
      llm: { provider: "openai", model: "gpt-4" },
      tools: [{ name: "search" }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools[0].enabled).toBe(true);
    }
  });

  it("should validate governance hook defaults", () => {
    const result = AgentManifestSchema.safeParse({
      name: "test",
      llm: { provider: "openai", model: "gpt-4" },
      governance: {
        hooks: [{ hook: "H1" as const }],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.governance?.hooks?.[0].enabled).toBe(true);
      expect(result.data.governance?.auditLog).toBe(false);
    }
  });

  it("should validate memory defaults", () => {
    const result = AgentManifestSchema.safeParse({
      name: "test",
      llm: { provider: "openai", model: "gpt-4" },
      memory: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.memory?.maxMessages).toBe(50);
      expect(result.data.memory?.semanticRecall).toBe(false);
    }
  });

  it("should validate knowledge defaults", () => {
    const result = AgentManifestSchema.safeParse({
      name: "test",
      llm: { provider: "openai", model: "gpt-4" },
      knowledge: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.knowledge?.policy).toBe("allow-all");
    }
  });
});
