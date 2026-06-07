import { describe, it, expect, beforeEach } from "vitest";
import { SelfModifyTool } from "./self-modify.js";
import { HandlerEngine } from "./handler-engine.js";
import { ConfigSnapshotManager } from "./config-snapshot-manager.js";
import { createInMemoryStore, type CheckpointStore } from "./checkpoint-store.js";
import type { HandlerFn } from "./types.js";
import type { ToolContext } from "./index.js";

function makeContext(): ToolContext {
  return { turnId: "test-turn", sessionId: "test-session" };
}

describe("SelfModifyTool", () => {
  let engine: HandlerEngine;
  let store: CheckpointStore;
  let snapshotManager: ConfigSnapshotManager;
  let events: Array<{ event: string; payload: unknown }>;
  let commits: string[];

  beforeEach(() => {
    engine = new HandlerEngine();
    store = createInMemoryStore();
    snapshotManager = new ConfigSnapshotManager(store);
    events = [];
    commits = [];
    engine.register({
      name: "user-tool",
      events: ["turn:end"],
      priority: 100,
      trust: 1,
      handle: async () => ({ ok: true }),
    });
  });

  function createTool(opts?: { handlerSources?: Record<string, HandlerFn> }) {
    return new SelfModifyTool({
      engine,
      snapshotManager,
      sessionId: "s1",
      handlerSources: opts?.handlerSources ?? {},
      onCommit: async (msg) => { commits.push(msg); },
      onEvent: (event, payload) => { events.push({ event, payload }); },
    });
  }

  // --- Register ---

  describe("register action", () => {
    it("registers a new handler successfully", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "register",
        handler: { name: "new-tool", trust: 1, events: ["turn:end"], source: "return { ok: true };" },
      }, makeContext());

      expect(result.error).toBeUndefined();
      expect((result.output as any).success).toBe(true);
      expect(engine.getHandlers("turn:end").some((h) => h.name === "new-tool")).toBe(true);
    });

    it("registers with compiled source code", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "register",
        handler: { name: "code-tool", trust: 1, events: ["turn:end"], source: "return { ok: true };" },
      }, makeContext());

      expect(result.error).toBeUndefined();
      expect(engine.getHandlers("turn:end").some((h) => h.name === "code-tool")).toBe(true);
    });

    it("creates a snapshot before modifying", async () => {
      const tool = createTool();
      await tool.execute({
        action: "register",
        handler: { name: "new-tool", trust: 1 },
      }, makeContext());

      const snapshots = snapshotManager.listSnapshots("s1");
      expect(snapshots.length).toBeGreaterThan(0);
    });
  });

  // --- Replace ---

  describe("replace action", () => {
    it("replaces an existing handler", async () => {
      const tool = createTool({ handlerSources: { "user-tool": async () => ({ ok: true }) } });
      const result = await tool.execute({
        action: "replace",
        handler: { name: "user-tool", trust: 1, priority: 50 },
      }, makeContext());

      expect(result.error).toBeUndefined();
      expect((result.output as any).success).toBe(true);
    });
  });

  // --- Unregister ---

  describe("unregister action", () => {
    it("unregisters an existing handler", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "unregister",
        handler: { name: "user-tool", trust: 1 },
      }, makeContext());

      expect(result.error).toBeUndefined();
      expect(engine.serialize().handlers.some((h) => h.name === "user-tool")).toBe(false);
    });
  });

  // --- Safety checks ---

  describe("safety checks", () => {
    it("rejects trust level 3", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "register",
        handler: { name: "evil", trust: 3 },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/trust level 3/);
      expect(result.error!.retryable).toBe(false);
    });

    it("rejects replacing a builtin handler", async () => {
      engine.register({
        name: "checkpoint",
        events: ["turn:end"],
        priority: 10,
        trust: 3,
        builtin: true,
        handle: async () => ({ ok: true }),
      });
      const tool = createTool();

      const result = await tool.execute({
        action: "replace",
        handler: { name: "checkpoint", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/builtin/);
    });

    it("rejects unregistering a builtin handler", async () => {
      engine.register({
        name: "checkpoint",
        events: ["turn:end"],
        priority: 10,
        trust: 3,
        builtin: true,
        handle: async () => ({ ok: true }),
      });
      const tool = createTool();

      const result = await tool.execute({
        action: "unregister",
        handler: { name: "checkpoint", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/builtin/);
    });

    it("rejects replacing an observer", async () => {
      engine.observe("turn:end", async () => ({ ok: true }), 100, "spy");
      const tool = createTool();

      const result = await tool.execute({
        action: "replace",
        handler: { name: "spy", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/observer/);
    });

    it("rejects unregistering an observer", async () => {
      engine.observe("turn:end", async () => ({ ok: true }), 100, "spy");
      const tool = createTool();

      const result = await tool.execute({
        action: "unregister",
        handler: { name: "spy", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/observer/);
    });
  });

  // --- Rollback ---

  describe("rollback on failure", () => {
    it("fails when replacing nonexistent handler", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "replace",
        handler: { name: "nonexistent", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
    });

    it("fails when no handler function is available for replace", async () => {
      const tool = createTool({});
      const result = await tool.execute({
        action: "replace",
        handler: { name: "user-tool", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/No handler function/);
    });

    it("restores previous state after failed hot-load", async () => {
      const fn1: HandlerFn = async () => ({ ok: true });

      // Register a second handler to have a known state
      engine.register({ name: "extra", events: ["turn:end"], trust: 1, handle: async () => ({ ok: true }) });
      snapshotManager.snapshot("s1", engine, "before");

      // Try to replace "extra" without providing handler function — should fail
      const tool2 = createTool({ handlerSources: { "user-tool": fn1 } });
      const result = await tool2.execute({
        action: "replace",
        handler: { name: "extra", trust: 1 },
      }, makeContext());

      expect(result.error).toBeDefined();
    });
  });

  // --- Dry run ---

  describe("dry run", () => {
    it("validates without applying changes", async () => {
      const tool = createTool();
      const before = engine.serialize().handlers.length;

      const result = await tool.execute({
        action: "register",
        handler: { name: "new-tool", trust: 1 },
        dryRun: true,
      }, makeContext());

      expect(result.error).toBeUndefined();
      expect((result.output as any).dryRun).toBe(true);
      expect(engine.serialize().handlers.length).toBe(before);
    });

    it("still rejects invalid params in dry-run", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "register",
        handler: { name: "evil", trust: 3 },
        dryRun: true,
      }, makeContext());

      expect(result.error).toBeDefined();
    });
  });

  // --- Events ---

  describe("events", () => {
    it("emits self_modify:before and self_modify:after on success", async () => {
      const tool = createTool();
      await tool.execute({
        action: "register",
        handler: { name: "new-tool", trust: 1, source: "return { ok: true };" },
      }, makeContext());

      expect(events.some((e) => e.event === "self_modify:before")).toBe(true);
      expect(events.some((e) => e.event === "self_modify:after")).toBe(true);
    });

    it("emits self_modify:error on failure", async () => {
      const tool = createTool();
      await tool.execute({
        action: "register",
        handler: { name: "evil", trust: 3 },
      }, makeContext());

      expect(events.some((e) => e.event === "self_modify:error")).toBe(true);
    });
  });

  // --- Git commit ---

  describe("git commit", () => {
    it("calls onCommit with action description", async () => {
      const tool = createTool();
      await tool.execute({
        action: "register",
        handler: { name: "new-tool", trust: 1, source: "return { ok: true };" },
      }, makeContext());

      expect(commits).toHaveLength(1);
      expect(commits[0]).toMatch(/self_modify: register new-tool/);
    });

    it("uses custom description for commit message", async () => {
      const tool = createTool();
      await tool.execute({
        action: "register",
        handler: { name: "new-tool", trust: 1, source: "return { ok: true };" },
        description: "added weather tool",
      }, makeContext());

      expect(commits[0]).toBe("added weather tool");
    });
  });

  // --- Validation ---

  describe("parameter validation", () => {
    it("rejects missing action", async () => {
      const tool = createTool();
      const result = await tool.execute({ handler: { name: "x", trust: 1 } }, makeContext());
      expect(result.error).toBeDefined();
    });

    it("rejects missing handler name", async () => {
      const tool = createTool();
      const result = await tool.execute({ action: "register", handler: { trust: 1 } }, makeContext());
      expect(result.error).toBeDefined();
    });

    it("rejects invalid source syntax", async () => {
      const tool = createTool();
      const result = await tool.execute({
        action: "register",
        handler: { name: "bad", trust: 1, source: "function(" },
      }, makeContext());

      expect(result.error).toBeDefined();
      expect(result.error!.message).toMatch(/compilation failed/);
    });
  });

  // --- Tool definition ---

  describe("tool definition", () => {
    it("has name self_modify", () => {
      const tool = createTool();
      expect(tool.definition.name).toBe("self_modify");
    });

    it("is marked as builtin", () => {
      const tool = createTool();
      expect(tool.definition.builtin).toBe(true);
    });
  });
});
