import { z } from "zod";
import type { Tool, ToolDefinition, ToolResult } from "./types.js";
import type { ToolContext } from "./types.js";
import type { HandlerEngine } from "./handler-engine.js";
import type { HandlerFn, HandlerResult } from "./types.js";
import type { ConfigSnapshotManager } from "./config-snapshot-manager.js";
import { HandlerResultSchema } from "./schemas/handler.js";

// --- Parameter schema ---

export const SelfModifyParams = z.object({
  action: z.enum(["register", "replace", "unregister"]),
  handler: z.object({
    name: z.string().min(1),
    phases: z.array(z.string()).optional(),
    events: z.array(z.string()).optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    trust: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    source: z.string().optional(),
  }).required({ name: true, trust: true }),
  dryRun: z.boolean().optional(),
  description: z.string().optional(),
});

export type SelfModifyParamsType = z.infer<typeof SelfModifyParams>;

// --- Options ---

export interface SelfModifyToolOptions {
  engine: HandlerEngine;
  snapshotManager: ConfigSnapshotManager;
  sessionId: string;
  handlerSources?: Record<string, HandlerFn>;
  onCommit?: (message: string) => Promise<void>;
  onEvent?: (event: string, payload: unknown) => void;
}

// --- Handler source compilation ---

function compileHandlerSource(source: string): HandlerFn {
  const fn = new Function("ctx", source) as (ctx: unknown) => Promise<HandlerResult>;
  return async (ctx: unknown) => {
    const raw = await fn(ctx);
    const result = HandlerResultSchema.safeParse(raw);
    if (!result.success) {
      return { error: { message: `Compiled handler returned invalid result: ${result.error.message}` }, recoverable: false };
    }
    return result.data as HandlerResult;
  };
}

// --- SelfModifyTool ---

export class SelfModifyTool implements Tool {
  readonly definition: ToolDefinition;
  private readonly engine: HandlerEngine;
  private readonly snapshotManager: ConfigSnapshotManager;
  private readonly sessionId: string;
  private readonly handlerSources: Record<string, HandlerFn>;
  private readonly onCommit: (message: string) => Promise<void>;
  private readonly onEvent: (event: string, payload: unknown) => void;

  constructor(opts: SelfModifyToolOptions) {
    this.definition = {
      name: "self_modify",
      description: "Register, replace, or unregister handlers at runtime. Creates a snapshot before modification for rollback safety.",
      parameters: {},
      builtin: true,
    };
    this.engine = opts.engine;
    this.snapshotManager = opts.snapshotManager;
    this.sessionId = opts.sessionId;
    this.handlerSources = opts.handlerSources ?? {};
    this.onCommit = opts.onCommit ?? (async () => {});
    this.onEvent = opts.onEvent ?? (() => {});
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const parsed = SelfModifyParams.safeParse(params);
    if (!parsed.success) {
      return { output: null, error: { message: `Invalid parameters: ${parsed.error.message}`, retryable: false } };
    }

    const { action, handler, dryRun, description } = parsed.data;
    const handlerName = handler.name;
    const commitMsg = description ?? `self_modify: ${action} ${handlerName}`;

    this.onEvent("self_modify:before", { action, handlerName });

    // --- Safety checks ---
    if (handler.trust === 3) {
      const msg = `Cannot create handler with trust level 3 (core protection)`;
      this.onEvent("self_modify:error", { action, handlerName, error: msg });
      return { output: null, error: { message: msg, retryable: false } };
    }

    if (action === "replace" || action === "unregister") {
      const current = this.engine.serialize().handlers.find((h) => h.name === handlerName);
      if (!current) {
        return { output: null, error: { message: `Handler "${handlerName}" not found`, retryable: false } };
      }
      if (current.kind === "observer") {
        const msg = `Cannot ${action} observer "${handlerName}"`;
        this.onEvent("self_modify:error", { action, handlerName, error: msg });
        return { output: null, error: { message: msg, retryable: false } };
      }
      if (current.builtin) {
        const msg = `Cannot ${action} builtin handler "${handlerName}"`;
        this.onEvent("self_modify:error", { action, handlerName, error: msg });
        return { output: null, error: { message: msg, retryable: false } };
      }
    }

    // --- Compile source if provided ---
    let compiledFn: HandlerFn | undefined;
    if (handler.source) {
      try {
        compiledFn = compileHandlerSource(handler.source);
      } catch (err: any) {
        const msg = `Handler source compilation failed: ${err.message}`;
        this.onEvent("self_modify:error", { action, handlerName, error: msg });
        return { output: null, error: { message: msg, retryable: false } };
      }
    }

    // --- Dry run ---
    if (dryRun) {
      return { output: { dryRun: true, action, handlerName, valid: true } };
    }

    // --- Snapshot ---
    const snap = this.snapshotManager.snapshot(this.sessionId, this.engine, commitMsg);

    // --- Git commit ---
    try {
      await this.onCommit(commitMsg);
    } catch (err: any) {
      this.onEvent("self_modify:error", { action, handlerName, error: `Git commit failed: ${err.message}` });
      return { output: null, error: { message: `Git commit failed: ${err.message}`, retryable: false } };
    }

    // --- Hot-load ---
    try {
      const handle = compiledFn ?? this.handlerSources[handlerName];
      if ((action === "register" || action === "replace") && !handle) {
        throw new Error(`No handler function provided for "${handlerName}" (supply source or handlerSources)`);
      }

      switch (action) {
        case "register":
          this.engine.register({
            name: handlerName,
            phases: handler.phases as any,
            events: handler.events,
            priority: handler.priority,
            trust: handler.trust,
            builtin: false,
            handle: handle!,
          });
          if (compiledFn) this.handlerSources[handlerName] = compiledFn;
          break;
        case "replace":
          this.engine.replace(handlerName, {
            name: handlerName,
            phases: handler.phases as any,
            events: handler.events,
            priority: handler.priority,
            trust: handler.trust,
            builtin: false,
            handle: handle!,
          });
          if (compiledFn) this.handlerSources[handlerName] = compiledFn;
          break;
        case "unregister":
          this.engine.unregister(handlerName);
          delete this.handlerSources[handlerName];
          break;
      }
    } catch (err: any) {
      // --- Rollback on failure ---
      try {
        this.snapshotManager.rollback(this.sessionId, this.engine, this.handlerSources);
      } catch { /* rollback best-effort */ }
      try {
        await this.onCommit(`revert: ${commitMsg}`);
      } catch { /* git revert best-effort */ }
      this.onEvent("self_modify:error", { action, handlerName, error: err.message });
      return { output: null, error: { message: `Hot-load failed, rolled back: ${err.message}`, retryable: false } };
    }

    this.onEvent("self_modify:after", { action, handlerName });
    return { output: { success: true, action, handlerName, snapshotId: snap.timestamp } };
  }
}
