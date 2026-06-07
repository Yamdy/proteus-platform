import { SessionContext } from "./context.js";
import type { SessionStore } from "./checkpoint-store.js";
import type { SessionConfig } from "./types.js";
import { SessionConfigSchema } from "./schemas/session.js";

export interface SessionManagerOptions {
  store: SessionStore;
}

/** Per-key async lock — serializes concurrent operations on the same key. */
class KeyLock {
  private locks = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    let release: () => void;
    const current = new Promise<void>((r) => { release = r; });
    this.locks.set(key, prev.then(() => current));
    await prev;
    try {
      return await fn();
    } finally {
      release!();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

export class SessionManager {
  private readonly store: SessionStore;
  private readonly sessions = new Map<string, SessionContext>();
  private readonly lock = new KeyLock();

  constructor(opts: SessionManagerOptions) {
    this.store = opts.store;
    this.loadExistingSessions();
  }

  private loadExistingSessions(): void {
    const metas = this.store.listSessions();
    for (const meta of metas) {
      const session = new SessionContext(meta.config);
      this.sessions.set(meta.sessionId, session);
    }
  }

  create(sessionId: string, config: SessionConfig): SessionContext {
    const parsed = SessionConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new Error(`Invalid SessionConfig: ${parsed.error.issues.map(i => i.message).join(", ")}`);
    }
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session "${sessionId}" already exists`);
    }
    const session = new SessionContext(config);
    this.sessions.set(sessionId, session);
    this.store.createSession({ sessionId, config });
    return session;
  }

  get(sessionId: string): SessionContext | undefined {
    return this.sessions.get(sessionId);
  }

  destroy(sessionId: string): void {
    if (!this.sessions.has(sessionId)) return;
    this.sessions.delete(sessionId);
    this.store.deleteSession(sessionId);
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }

  /** Serialize an async operation on a specific session (prevents concurrent runTurn). */
  async runWithLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    return this.lock.run(sessionId, fn);
  }
}
