// @proteus-ai/core — SQLite-backed CheckpointStore implementation
// Migrated from Proteus. Zero logic changes, import paths only.

import Database from "better-sqlite3";
import type {
  CheckpointStore, SessionMeta, StoreEvent, ConfigSnapshot, CostRecord,
  SessionStore, MessageStore, CheckpointLog, EventLog, ConfigStore, CostStore,
  ThreadMeta, ThreadStore,
} from "./checkpoint-store.js";
import { bindMethods } from "./checkpoint-store.js";
import type { LLMMessage } from "./types.js";
import type { FrozenContext } from "./context.js";

// --- Schema migration ---

function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      thread_id TEXT,
      payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS config_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      handlers TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      description TEXT,
      checksum TEXT
    );
    CREATE TABLE IF NOT EXISTS cost_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `);
  try { db.exec(`ALTER TABLE config_snapshots ADD COLUMN description TEXT`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE config_snapshots ADD COLUMN checksum TEXT`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE messages ADD COLUMN thread_id TEXT`); } catch { /* exists */ }
}

// --- Per-concern SQLite implementations ---

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database.Database) {}

  createSession(meta: SessionMeta): void {
    const now = Date.now();
    this.db.prepare("INSERT INTO sessions (session_id, config, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      meta.sessionId, JSON.stringify(meta.config), meta.createdAt ?? now, meta.updatedAt ?? now,
    );
  }

  loadSession(sessionId: string): SessionMeta | undefined {
    const row = this.db.prepare("SELECT session_id, config, created_at, updated_at FROM sessions WHERE session_id = ?").get(sessionId) as any;
    if (!row) return undefined;
    return { sessionId: row.session_id, config: JSON.parse(row.config), createdAt: row.created_at, updatedAt: row.updated_at };
  }

  updateSession(sessionId: string, patch: Partial<SessionMeta>): void {
    const existing = this.loadSession(sessionId);
    if (!existing) return;
    const merged = { ...existing, ...patch, updatedAt: Date.now() };
    this.db.prepare("UPDATE sessions SET config = ?, updated_at = ? WHERE session_id = ?").run(
      JSON.stringify(merged.config), merged.updatedAt, sessionId,
    );
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  listSessions(): SessionMeta[] {
    const rows = this.db.prepare("SELECT session_id, config, created_at, updated_at FROM sessions").all() as any[];
    return rows.map((r) => ({ sessionId: r.session_id, config: JSON.parse(r.config), createdAt: r.created_at, updatedAt: r.updated_at }));
  }
}

export class SqliteMessageStore implements MessageStore {
  constructor(private readonly db: Database.Database) {}

  addMessages(sessionId: string, messages: LLMMessage[]): void {
    const stmt = this.db.prepare("INSERT INTO messages (session_id, payload) VALUES (?, ?)");
    for (const msg of messages) stmt.run(sessionId, JSON.stringify(msg));
  }

  loadMessages(sessionId: string): LLMMessage[] {
    const rows = this.db.prepare("SELECT payload FROM messages WHERE session_id = ?").all(sessionId) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload));
  }
}

export class SqliteCheckpointLog implements CheckpointLog {
  constructor(private readonly db: Database.Database) {}

  saveCheckpoint(checkpoint: FrozenContext): void {
    this.db.prepare("INSERT INTO checkpoints (session_id, turn_id, payload, timestamp) VALUES (?, ?, ?, ?)").run(
      checkpoint.sessionId, checkpoint.turnId, JSON.stringify(checkpoint), checkpoint.timestamp,
    );
  }

  loadLatestCheckpoint(sessionId: string): FrozenContext | undefined {
    const row = this.db.prepare("SELECT payload FROM checkpoints WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1").get(sessionId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }

  loadCheckpoint(sessionId: string, turnId: string): FrozenContext | undefined {
    const row = this.db.prepare("SELECT payload FROM checkpoints WHERE session_id = ? AND turn_id = ?").get(sessionId, turnId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
}

export class SqliteEventLog implements EventLog {
  constructor(private readonly db: Database.Database) {}

  appendEvent(event: StoreEvent): void {
    this.db.prepare("INSERT INTO event_log (session_id, event, payload, timestamp) VALUES (?, ?, ?, ?)").run(
      event.sessionId, event.event, event.payload !== undefined ? JSON.stringify(event.payload) : null, event.timestamp,
    );
  }

  queryEvents(sessionId: string, since?: number): StoreEvent[] {
    const sql = since !== undefined
      ? "SELECT session_id, event, payload, timestamp FROM event_log WHERE session_id = ? AND timestamp >= ? ORDER BY timestamp"
      : "SELECT session_id, event, payload, timestamp FROM event_log WHERE session_id = ? ORDER BY timestamp";
    const rows = since !== undefined
      ? this.db.prepare(sql).all(sessionId, since) as any[]
      : this.db.prepare(sql).all(sessionId) as any[];
    return rows.map((r) => ({ sessionId: r.session_id, event: r.event, payload: r.payload ? JSON.parse(r.payload) : undefined, timestamp: r.timestamp }));
  }

  queryAllEvents(start?: number, end?: number): StoreEvent[] {
    let sql = "SELECT session_id, event, payload, timestamp FROM event_log WHERE 1=1";
    const params: number[] = [];
    if (start !== undefined) { sql += " AND timestamp >= ?"; params.push(start); }
    if (end !== undefined) { sql += " AND timestamp <= ?"; params.push(end); }
    sql += " ORDER BY timestamp";
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({ sessionId: r.session_id, event: r.event, payload: r.payload ? JSON.parse(r.payload) : undefined, timestamp: r.timestamp }));
  }
}

export class SqliteConfigStore implements ConfigStore {
  constructor(private readonly db: Database.Database) {}

  saveConfigSnapshot(snapshot: ConfigSnapshot): void {
    this.db.prepare("INSERT INTO config_snapshots (session_id, handlers, timestamp, description, checksum) VALUES (?, ?, ?, ?, ?)").run(
      snapshot.sessionId, JSON.stringify(snapshot.handlers), snapshot.timestamp, snapshot.description ?? null, snapshot.checksum ?? null,
    );
  }

  loadLatestConfigSnapshot(sessionId: string): ConfigSnapshot | undefined {
    const row = this.db.prepare("SELECT handlers, timestamp, description, checksum FROM config_snapshots WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1").get(sessionId) as any;
    if (!row) return undefined;
    return { sessionId, handlers: JSON.parse(row.handlers), timestamp: row.timestamp, description: row.description ?? undefined, checksum: row.checksum ?? undefined };
  }

  listConfigSnapshots(sessionId: string): ConfigSnapshot[] {
    const rows = this.db.prepare("SELECT handlers, timestamp, description, checksum FROM config_snapshots WHERE session_id = ? ORDER BY timestamp").all(sessionId) as any[];
    return rows.map((r) => ({ sessionId, handlers: JSON.parse(r.handlers), timestamp: r.timestamp, description: r.description ?? undefined, checksum: r.checksum ?? undefined }));
  }
}

export class SqliteCostStore implements CostStore {
  constructor(private readonly db: Database.Database) {}

  addCostRecord(record: CostRecord): void {
    this.db.prepare("INSERT INTO cost_records (session_id, turn_id, prompt_tokens, completion_tokens, timestamp) VALUES (?, ?, ?, ?, ?)").run(
      record.sessionId, record.turnId, record.promptTokens, record.completionTokens, record.timestamp,
    );
  }

  loadCostRecords(sessionId: string): CostRecord[] {
    const rows = this.db.prepare("SELECT turn_id, prompt_tokens, completion_tokens, timestamp FROM cost_records WHERE session_id = ?").all(sessionId) as any[];
    return rows.map((r) => ({ sessionId, turnId: r.turn_id, promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens, timestamp: r.timestamp }));
  }
}

export class SqliteThreadStore implements ThreadStore {
  constructor(private readonly db: Database.Database) {}

  createThread(meta: ThreadMeta): void {
    const now = Date.now();
    this.db.prepare("INSERT INTO threads (thread_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      meta.threadId, meta.name, meta.createdAt ?? now, meta.updatedAt ?? now,
    );
  }

  loadThread(threadId: string): ThreadMeta | undefined {
    const row = this.db.prepare("SELECT thread_id, name, created_at, updated_at FROM threads WHERE thread_id = ?").get(threadId) as any;
    if (!row) return undefined;
    return { threadId: row.thread_id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  updateThread(threadId: string, patch: Partial<Omit<ThreadMeta, "threadId">>): void {
    const existing = this.loadThread(threadId);
    if (!existing) return;
    const merged = { ...existing, ...patch, updatedAt: Date.now() };
    this.db.prepare("UPDATE threads SET name = ?, updated_at = ? WHERE thread_id = ?").run(merged.name, merged.updatedAt, threadId);
  }

  deleteThread(threadId: string): void {
    this.db.prepare("DELETE FROM threads WHERE thread_id = ?").run(threadId);
    this.db.prepare("DELETE FROM messages WHERE thread_id = ?").run(threadId);
  }

  listThreads(): ThreadMeta[] {
    const rows = this.db.prepare("SELECT thread_id, name, created_at, updated_at FROM threads").all() as any[];
    return rows.map((r) => ({ threadId: r.thread_id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  addThreadMessages(threadId: string, messages: LLMMessage[]): void {
    const stmt = this.db.prepare("INSERT INTO messages (thread_id, payload) VALUES (?, ?)");
    for (const msg of messages) stmt.run(threadId, JSON.stringify(msg));
  }

  loadThreadMessages(threadId: string): LLMMessage[] {
    const rows = this.db.prepare("SELECT payload FROM messages WHERE thread_id = ?").all(threadId) as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload));
  }
}

// --- Factory ---

export function createSqliteStore(dbPath: string): CheckpointStore & { close(): void; getTableNames(): string[]; getJournalMode(): string } {
  const db = new Database(dbPath);
  migrate(db);

  const session = new SqliteSessionStore(db);
  const message = new SqliteMessageStore(db);
  const checkpoint = new SqliteCheckpointLog(db);
  const event = new SqliteEventLog(db);
  const config = new SqliteConfigStore(db);
  const cost = new SqliteCostStore(db);
  const thread = new SqliteThreadStore(db);

  return Object.assign(
    {},
    bindMethods(session), bindMethods(message), bindMethods(checkpoint),
    bindMethods(event), bindMethods(config), bindMethods(cost), bindMethods(thread),
    {
      close(): void { db.close(); },
      getTableNames(): string[] {
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
        return rows.map((r) => r.name);
      },
      getJournalMode(): string {
        return db.pragma("journal_mode", { simple: true }) as string;
      },
    },
  ) as CheckpointStore & { close(): void; getTableNames(): string[]; getJournalMode(): string };
}
