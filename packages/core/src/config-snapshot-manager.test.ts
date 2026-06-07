import { describe, it, expect, beforeEach } from "vitest";
import { ConfigSnapshotManager } from "./config-snapshot-manager.js";
import { HandlerEngine } from "./handler-engine.js";
import { createInMemoryStore, type CheckpointStore } from "./checkpoint-store.js";
import type { HandlerDefinition } from "./index.js";
import type { HandlerFn } from "./types.js";

function makeHandler(name: string, opts?: { events?: string[]; priority?: number; builtin?: boolean; trust?: 0 | 1 | 2 | 3 }): HandlerDefinition {
  return {
    name,
    events: opts?.events ?? ["turn:end"],
    priority: opts?.priority ?? 100,
    trust: opts?.trust ?? 1,
    builtin: opts?.builtin ?? false,
    handle: async () => ({ ok: true }),
  };
}

describe("ConfigSnapshotManager", () => {
  let store: CheckpointStore;
  let manager: ConfigSnapshotManager;

  beforeEach(() => {
    store = createInMemoryStore();
    manager = new ConfigSnapshotManager(store);
  });

  describe("snapshot()", () => {
    it("saves engine state as a config snapshot", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      const snap = manager.snapshot("s1", engine);

      expect(snap.sessionId).toBe("s1");
      expect(snap.handlers).toBeDefined();
      expect(snap.timestamp).toBeGreaterThan(0);
      expect(snap.checksum).toBeDefined();
    });

    it("stores description when provided", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      const snap = manager.snapshot("s1", engine, "before adding tool");

      expect(snap.description).toBe("before adding tool");
    });

    it("captures all handler metadata (name, kind, trust, priority)", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("interceptor-1", { priority: 50, trust: 1 }));
      engine.observe("turn:end", async () => ({ ok: true }), 200, "observer-1");

      const snap = manager.snapshot("s1", engine);
      const handlers = (snap.handlers as any).handlers;

      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toMatchObject({ name: "interceptor-1", kind: "interceptor", priority: 50, trust: 1 });
      expect(handlers[1]).toMatchObject({ name: "observer-1", kind: "observer", priority: 200, trust: 3 });
    });

    it("excludes handler functions from snapshot (JSON-serializable)", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      const snap = manager.snapshot("s1", engine);

      expect(() => JSON.stringify(snap)).not.toThrow();
      const handlers = (snap.handlers as any).handlers;
      expect(handlers[0]).not.toHaveProperty("handle");
    });

    it("checksum changes when engine state changes", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      const snap1 = manager.snapshot("s1", engine);
      engine.register(makeHandler("h2"));
      const snap2 = manager.snapshot("s1", engine);

      expect(snap1.checksum).not.toBe(snap2.checksum);
    });

    it("checksum is a 64-character hex string (SHA-256)", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      const snap = manager.snapshot("s1", engine);

      expect(snap.checksum).toHaveLength(64);
      expect(snap.checksum).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("rollback()", () => {
    it("restores engine to the snapshotted state", () => {
      const fn1: HandlerFn = async () => ({ ok: true });
      const fn2: HandlerFn = async () => ({ ok: true });
      const fn3: HandlerFn = async () => ({ ok: true });

      const engine = new HandlerEngine();
      engine.register({ ...makeHandler("h1"), handle: fn1 });
      engine.register({ ...makeHandler("h2"), handle: fn2 });

      manager.snapshot("s1", engine);

      engine.register({ ...makeHandler("h3"), handle: fn3 });
      expect(engine.getHandlers("turn:end")).toHaveLength(3);

      manager.rollback("s1", engine, { h1: fn1, h2: fn2 });

      const handlers = engine.getHandlers("turn:end");
      expect(handlers.map((h) => h.name)).toContain("h1");
      expect(handlers.map((h) => h.name)).toContain("h2");
    });

    it("throws when no config snapshot exists", () => {
      const engine = new HandlerEngine();
      expect(() => manager.rollback("missing", engine, {})).toThrow(/No config snapshot found/);
    });

    it("snapshot → modify → snapshot → rollback chain", () => {
      const fn1: HandlerFn = async () => ({ ok: true });
      const fn2: HandlerFn = async () => ({ ok: true });
      const fn3: HandlerFn = async () => ({ ok: true });

      const engine = new HandlerEngine();
      engine.register({ ...makeHandler("h1"), handle: fn1 });

      manager.snapshot("s1", engine, "snap-A");

      engine.register({ ...makeHandler("h2"), handle: fn2 });
      manager.snapshot("s1", engine, "snap-B");

      engine.register({ ...makeHandler("h3"), handle: fn3 });

      // Rollback to latest (snap-B)
      manager.rollback("s1", engine, { h1: fn1, h2: fn2 });
      const afterRollback = engine.getHandlers("turn:end");
      expect(afterRollback.some((h) => h.name === "h3")).toBe(false);
    });

    it("preserves builtin handlers during rollback", () => {
      const fn1: HandlerFn = async () => ({ ok: true });
      const builtinFn: HandlerFn = async () => ({ ok: true });

      const engine = new HandlerEngine();
      engine.register({ ...makeHandler("builtin-tool", { builtin: true, trust: 3 }), handle: builtinFn });
      engine.register({ ...makeHandler("user-tool"), handle: fn1 });

      manager.snapshot("s1", engine);

      const fn2: HandlerFn = async () => ({ ok: true });
      engine.register({ ...makeHandler("extra-tool"), handle: fn2 });

      manager.rollback("s1", engine, { "builtin-tool": builtinFn, "user-tool": fn1 });

      const handlers = engine.getHandlers("turn:end");
      expect(handlers.some((h) => h.name === "builtin-tool")).toBe(true);
    });
  });

  describe("listSnapshots()", () => {
    it("returns empty array for session with no snapshots", () => {
      expect(manager.listSnapshots("empty")).toEqual([]);
    });

    it("returns all snapshots in order", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      manager.snapshot("s1", engine, "first");
      manager.snapshot("s1", engine, "second");
      manager.snapshot("s1", engine, "third");

      const list = manager.listSnapshots("s1");
      expect(list).toHaveLength(3);
      expect(list[0].description).toBe("first");
      expect(list[1].description).toBe("second");
      expect(list[2].description).toBe("third");
    });

    it("returns snapshots only for the requested session", () => {
      const engine = new HandlerEngine();
      engine.register(makeHandler("h1"));

      manager.snapshot("s1", engine, "s1-snap");
      manager.snapshot("s2", engine, "s2-snap");

      expect(manager.listSnapshots("s1")).toHaveLength(1);
      expect(manager.listSnapshots("s2")).toHaveLength(1);
    });
  });
});
