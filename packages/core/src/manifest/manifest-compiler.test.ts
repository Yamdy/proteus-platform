import { describe, it, expect } from "vitest";
import { compileManifest, parseManifestYaml } from "./manifest-compiler.js";

describe("compileManifest", () => {
  const validManifest = {
    name: "test-agent",
    llm: {
      provider: "deepseek",
      model: "deepseek-chat",
    },
  };

  it("should compile a minimal manifest", () => {
    const result = compileManifest(validManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.manifest.name).toBe("test-agent");
    expect(result.config.sessionConfig.llm.provider).toBe("deepseek");
    expect(result.config.sessionConfig.llm.model).toBe("deepseek-chat");
    expect(result.config.sessionConfig.llm.temperature).toBe(0.7);
    expect(result.config.enabledTools).toEqual([]);
    expect(result.config.governanceHooks).toEqual([]);
    expect(result.config.auditLogEnabled).toBe(false);
  });

  it("should compile a full manifest", () => {
    const full = {
      name: "full-agent",
      description: "A full agent",
      llm: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.3,
        systemPrompt: "You are helpful.",
      },
      tools: [
        { name: "search", enabled: true },
        { name: "disabled-tool", enabled: false },
        { name: "default-tool" },
      ],
      governance: {
        hooks: [
          { hook: "H1", enabled: true, policy: "allow-all" },
          { hook: "H2", enabled: false },
          { hook: "H3", policy: "deny-list", config: { deny: ["secret"] } },
        ],
        auditLog: true,
      },
      quota: {
        maxTokensPerPeriod: 100000,
        maxRequestsPerPeriod: 50,
        periodSeconds: 1800,
        maxCostPerPeriod: 5.0,
      },
      tenantId: "tenant-abc",
    };

    const result = compileManifest(full);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cfg = result.config;

    // Session config
    expect(cfg.sessionConfig.llm.temperature).toBe(0.3);
    expect(cfg.sessionConfig.tools).toEqual({
      search: true,
      "disabled-tool": false,
      "default-tool": true,
    });

    // Enabled tools
    expect(cfg.enabledTools).toEqual(["search", "default-tool"]);

    // Governance
    expect(cfg.governanceHooks).toHaveLength(3);
    expect(cfg.governanceHooks[0]).toEqual({
      hook: "H1",
      enabled: true,
      policy: "allow-all",
      config: undefined,
    });
    expect(cfg.governanceHooks[1].enabled).toBe(false);
    expect(cfg.governanceHooks[2].config).toEqual({ deny: ["secret"] });
    expect(cfg.auditLogEnabled).toBe(true);

    // Quotas
    expect(cfg.quotas).toEqual({
      maxTokensPerPeriod: 100000,
      maxRequestsPerPeriod: 50,
      periodMs: 1_800_000,
      maxConcurrentSessions: undefined,
      maxCostPerPeriod: 5.0,
    });

    // Tenant
    expect(cfg.tenantId).toBe("tenant-abc");
  });

  it("should reject invalid manifest", () => {
    const result = compileManifest({ foo: "bar" });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toContain("Invalid manifest");
  });

  it("should reject manifest without name", () => {
    const result = compileManifest({
      llm: { provider: "openai", model: "gpt-4" },
    });

    expect(result.ok).toBe(false);
  });

  it("should reject manifest without llm", () => {
    const result = compileManifest({ name: "test" });

    expect(result.ok).toBe(false);
  });

  it("should handle session name from manifest", () => {
    const result = compileManifest(validManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.sessionConfig.name).toBe("test-agent");
    expect(result.config.sessionConfig.sessionId).toMatch(/^manifest-test-agent-/);
  });

  it("should handle quota period conversion (seconds to ms)", () => {
    const result = compileManifest({
      name: "test",
      llm: { provider: "openai", model: "gpt-4" },
      quota: { periodSeconds: 60 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.quotas?.periodMs).toBe(60_000);
  });
});

describe("parseManifestYaml", () => {
  it("should parse JSON string as fallback", () => {
    const json = JSON.stringify({
      name: "json-agent",
      llm: { provider: "openai", model: "gpt-4" },
    });

    const result = parseManifestYaml(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.manifest.name).toBe("json-agent");
  });

  it("should use provided YAML parser", () => {
    const yamlLike = "custom-format";
    const customParser = (input: string) => ({
      name: "parsed-from-yaml",
      llm: { provider: "deepseek", model: "deepseek-chat" },
      _source: input,
    });

    const result = parseManifestYaml(yamlLike, customParser);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.manifest.name).toBe("parsed-from-yaml");
  });

  it("should handle invalid JSON gracefully", () => {
    const result = parseManifestYaml("not-valid-json");

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toContain("Failed to parse manifest");
  });

  it("should handle parser error gracefully", () => {
    const badParser = () => {
      throw new Error("YAML syntax error at line 5");
    };

    const result = parseManifestYaml("content", badParser);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.reason).toContain("YAML syntax error at line 5");
  });
});
