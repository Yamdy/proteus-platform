import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveEntryScript(): { path: string; execArgv?: string[] } {
  const jsPath = path.join(__dirname, "worker-entry.js");
  if (existsSync(jsPath)) return { path: jsPath };
  const tsPath = path.join(__dirname, "worker-entry.ts");
  return { path: tsPath, execArgv: ["--import", "tsx"] };
}

const ENTRY = resolveEntryScript();

export interface WorkerTask {
  handlerName: string;
  handlerSource: string;
  eventName: string;
  contextSnapshot: unknown;
}

export type WorkerResult =
  | { ok: true; handlerResult: unknown }
  | { ok: false; error: string; recoverable: boolean };

interface PendingTask {
  resolve: (result: WorkerResult) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

export interface WorkerPoolOptions {
  minWorkers?: number;
  maxWorkers?: number;
  taskTimeoutMs?: number;
}

export class WorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly pending = new Map<string, PendingTask>();
  private readonly queue: Array<{ task: WorkerTask; resolve: (r: WorkerResult) => void }> = [];
  private readonly minWorkers: number;
  private readonly maxWorkers: number;
  private readonly taskTimeoutMs: number;

  constructor(opts?: WorkerPoolOptions) {
    this.minWorkers = opts?.minWorkers ?? 1;
    this.maxWorkers = opts?.maxWorkers ?? this.minWorkers;
    this.taskTimeoutMs = opts?.taskTimeoutMs ?? 30_000;

    for (let i = 0; i < this.minWorkers; i++) {
      this.slots.push(this.createSlot());
    }
  }

  submit(task: WorkerTask): Promise<WorkerResult> {
    return new Promise<WorkerResult>((resolve) => {
      const slot = this.slots.find((s) => !s.busy);
      if (slot) {
        this.runOnSlot(slot, task, resolve);
      } else if (this.slots.length < this.maxWorkers) {
        const newSlot = this.createSlot();
        this.slots.push(newSlot);
        this.runOnSlot(newSlot, task, resolve);
      } else {
        this.queue.push({ task, resolve });
      }
    });
  }

  async shutdown(): Promise<void> {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    this.pending.clear();

    await Promise.all(
      this.slots.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.worker.once("exit", () => resolve());
            s.worker.terminate();
          }),
      ),
    );
    this.slots.length = 0;
  }

  private createSlot(): WorkerSlot {
    const worker = new Worker(ENTRY.path, { execArgv: ENTRY.execArgv });
    const slot: WorkerSlot = { worker, busy: false };

    worker.on("message", (msg: { type: string; taskId: string; ok: boolean; handlerResult?: unknown; error?: string }) => {
      if (msg.type !== "result") return;
      const pending = this.pending.get(msg.taskId);
      if (!pending) return;

      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(msg.taskId);

      if (msg.ok) {
        pending.resolve({ ok: true, handlerResult: msg.handlerResult });
      } else {
        pending.resolve({ ok: false, error: msg.error ?? "unknown error", recoverable: false });
      }

      slot.busy = false;
      this.drainQueue();
    });

    worker.on("error", (err: Error) => {
      slot.busy = false;
      for (const [taskId, pending] of this.pending) {
        if (pending.timer) clearTimeout(pending.timer);
        pending.resolve({
          ok: false,
          error: `Worker error: ${err.message}`,
          recoverable: false,
        });
        this.pending.delete(taskId);
      }
      this.recreateSlot(slot);
    });

    return slot;
  }

  private recreateSlot(slot: WorkerSlot): void {
    const index = this.slots.indexOf(slot);
    if (index === -1) return;
    const newSlot = this.createSlot();
    this.slots[index] = newSlot;
  }

  private runOnSlot(slot: WorkerSlot, task: WorkerTask, resolve: (r: WorkerResult) => void): void {
    slot.busy = true;
    const taskId = randomUUID();

    const timer = setTimeout(() => {
      this.pending.delete(taskId);
      slot.busy = false;
      resolve({ ok: false, error: "Task timeout", recoverable: false });
      slot.worker.terminate();
      this.recreateSlot(slot);
    }, this.taskTimeoutMs);

    this.pending.set(taskId, { resolve, timer });

    slot.worker.postMessage({
      type: "task",
      taskId,
      ...task,
    });
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const slot = this.slots.find((s) => !s.busy);
      if (!slot) break;
      const { task, resolve } = this.queue.shift()!;
      this.runOnSlot(slot, task, resolve);
    }
  }
}
