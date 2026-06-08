import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryAuditLog,
  createH1Hook,
  createH2Hook,
  createH3Hook,
  createH4Hook,
  registerGovernanceHooks,
} from "./governance-hooks.js";
import { HandlerEngine } from "../handler-engine.js";
import type { HandlerResult } from "../types.js";
import type { HandlerContext } from "../context.js";

// Minimal mock HandlerContext
function mockCtx(overrides?: Record<string, unknown>): HandlerContext {
  return {
    agent: { llm: {}, tools: new Map() } as any,
    session: {
      sessionId: "test-session",
      config: { sessionId: "test-session" },
      workingMemory: { getMessages: () => [] },
      costTracker: { getTotals: () => ({ promptTokens: 0, completionTokens: 0 }) },
    } as any,
    turn: {
      turnId: "test-turn",
      messages: [],
      toolCalls: [{ id: "tc1", name: "delete_file", arguments: { path: "/tmp/x" } }],
    } as any,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("InMemoryAuditLog", () => {
  it("should log and query decisions", () => {
    const log = new InMemoryAuditLog();
    log.log({ hook: "H1", action: "allow", reason: "ok", timestamp: 1 });
    log.log({ hook: "H2", action: "deny", reason: "blocked", agentId: "a", timestamp: 2 });

    expect(log.size).toBe(2);
    expect(log.query({ hook: "H2" })).toHaveLength(1);
    expect(log.query({ action: "deny" })).toHaveLength(1);
    expect(log.query({ agentId: "a" })).toHaveLength(1);
  });

  it("should clear", () => {
    const log = new InMemoryAuditLog();
    log.log({ hook: "H1", action: "allow", reason: "ok", timestamp: 1 });
    log.clear();
    expect(log.size).toBe(0);
  });
});

describe("H1 - Input Validation", () => {
  it("should pass when check returns null", async () => {
    const hook = createH1Hook(async () => null);
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: true });
  });

  it("should block when check returns { ok: false }", async () => {
    const hook = createH1Hook(async () => ({ ok: false as const, reason: "prompt injection detected" }));
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: false, reason: "prompt injection detected" });
  });

  it("should log to audit log", async () => {
    const auditLog = new InMemoryAuditLog();
    const hook = createH1Hook(async () => null, auditLog);
    await hook.handle(mockCtx());
    expect(auditLog.size).toBe(1);
    expect(auditLog.query()[0].hook).toBe("H1");
  });
});

describe("H2 - Action Validation", () => {
  it("should allow when check returns null", async () => {
    const hook = createH2Hook(async () => null);
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: true });
  });

  it("should suspend for human approval", async () => {
    const hook = createH2Hook(async () => ({ suspend: true, pendingInput: "Approve?" }));
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ suspend: true, pendingInput: "Approve?" });
  });

  it("should deny when check returns { ok: false }", async () => {
    const hook = createH2Hook(async () => ({ ok: false as const, reason: "tool not allowed" }));
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: false, reason: "tool not allowed" });
  });

  it("should log suspend decisions", async () => {
    const auditLog = new InMemoryAuditLog();
    const hook = createH2Hook(async () => ({ suspend: true }), auditLog);
    await hook.handle(mockCtx());
    expect(auditLog.query({ action: "suspend" })).toHaveLength(1);
  });
});

describe("H3 - Output Filtering", () => {
  it("should pass when check returns null", async () => {
    const hook = createH3Hook(async () => null);
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: true });
  });

  it("should block when output contains sensitive data", async () => {
    const hook = createH3Hook(async () => ({ ok: false as const, reason: "contains PII" }));
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: false, reason: "contains PII" });
  });
});

describe("H4 - Human Approval", () => {
  it("should allow when check returns null", async () => {
    const hook = createH4Hook(async () => null);
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ ok: true });
  });

  it("should suspend for human approval", async () => {
    const hook = createH4Hook(async () => ({ suspend: true }));
    const result = await hook.handle(mockCtx());
    expect(result).toEqual({ suspend: true });
  });
});

describe("registerGovernanceHooks", () => {
  it("should register H1-H4 hooks on HandlerEngine", () => {
    const engine = new HandlerEngine();
    registerGovernanceHooks(engine, {
      h1: async () => null,
      h2: async () => null,
      h3: async () => null,
      h4: async () => null,
    });

    const names = engine.serialize().handlers.map((h) => h.name);
    expect(names).toContain("governance-h1-input-validation");
    expect(names).toContain("governance-h2-action-validation");
    expect(names).toContain("governance-h3-output-filter");
    expect(names).toContain("governance-h4-human-approval");
  });

  it("should only register provided hooks", () => {
    const engine = new HandlerEngine();
    registerGovernanceHooks(engine, { h2: async () => null });
    const names = engine.serialize().handlers.map((h) => h.name);
    expect(names).not.toContain("governance-h1-input-validation");
    expect(names).toContain("governance-h2-action-validation");
  });
});
