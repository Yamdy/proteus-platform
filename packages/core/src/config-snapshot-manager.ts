import type { ConfigStore, ConfigSnapshot } from "./checkpoint-store.js";
import type { HandlerEngine, RegistrySnapshot } from "./handler-engine.js";
import type { HandlerFn } from "./types.js";
import { sha256 } from "./utils/hash.js";

export class ConfigSnapshotManager {
  constructor(private readonly store: ConfigStore) {}

  /**
   * Serialize the current HandlerEngine state and save it as a config snapshot.
   * Returns the saved ConfigSnapshot.
   */
  snapshot(sessionId: string, engine: HandlerEngine, description?: string): ConfigSnapshot {
    const registry = engine.serialize();
    const payload = JSON.stringify(registry);
    const checksum = sha256(payload);
    const snap: ConfigSnapshot = {
      sessionId,
      handlers: registry,
      timestamp: Date.now(),
      description,
      checksum,
    };
    this.store.saveConfigSnapshot(snap);
    return snap;
  }

  /**
   * Restore the engine to the latest config snapshot for the given session.
   * Handler functions are rebuilt from `handlerSources` (name → HandlerFn).
   * Throws if no config snapshot exists for the session.
   */
  rollback(sessionId: string, engine: HandlerEngine, handlerSources: Record<string, HandlerFn>): void {
    const snap = this.store.loadLatestConfigSnapshot(sessionId);
    if (!snap) {
      throw new Error(`No config snapshot found for session "${sessionId}"`);
    }

    const registry = snap.handlers as RegistrySnapshot;
    // Verify checksum (warn on mismatch, don't block)
    if (snap.checksum) {
      const actual = sha256(JSON.stringify(registry));
      if (actual !== snap.checksum) {
        console.warn(`ConfigSnapshotManager: checksum mismatch for session "${sessionId}" (expected ${snap.checksum}, got ${actual})`);
      }
    }

    // Remove current non-builtin interceptors
    const currentSnapshot = engine.serialize();
    for (const h of currentSnapshot.handlers) {
      if (h.kind === "interceptor" && !h.builtin) {
        try { engine.unregister(h.name); } catch { /* already gone or protected */ }
      }
    }

    // Re-register handlers from the snapshot
    for (const sh of registry.handlers) {
      if (sh.kind === "observer") continue; // observers are protected
      const handle = handlerSources[sh.name];
      if (!handle) throw new Error(`Handler function not found for "${sh.name}" during rollback`);
      // Skip builtin handlers — they're already registered
      if (sh.builtin) continue;
      try {
        engine.register({
          name: sh.name,
          phases: sh.phases as any,
          events: sh.events,
          priority: sh.priority,
          trust: sh.trust,
          builtin: sh.builtin,
          handle,
        });
      } catch {
        // Handler may already exist, skip
      }
    }
  }

  /**
   * List all config snapshots for a session, ordered by timestamp.
   */
  listSnapshots(sessionId: string): ConfigSnapshot[] {
    return this.store.listConfigSnapshots(sessionId);
  }
}
