import type { HandlerDefinition, HandlerResult, HandlerFn } from "./types.js";
import type { HandlerContext } from "./context.js";
import type { WorkerHandlerRunner } from "./worker-handler-runner.js";
import { HandlerResultSchema } from "./schemas/handler.js";

function matchesHandler(rh: RegisteredHandler, event: string, payload?: unknown): boolean {
  const h = rh.handler;
  const eventMatch = !h.events || h.events.includes(event);
  // When payload is absent (e.g. getHandlers query), treat phaseMatch as true
  // so handlers with phases are still discoverable.
  const phaseName = (payload as any)?.phaseName;
  const phaseMatch = !h.phases || !phaseName || h.phases.includes(phaseName);
  if (h.events && h.phases) return eventMatch && phaseMatch;
  if (h.events) return eventMatch;
  if (h.phases) return eventMatch && phaseMatch;
  return true;
}

export const isBlock = (r: HandlerResult): boolean => 'ok' in r && !r.ok;
export const isAbort = (r: HandlerResult): boolean => 'abort' in r && r.abort;
export const isSuspend = (r: HandlerResult): boolean => 'suspend' in r && r.suspend;
export const isTerminalError = (r: HandlerResult): boolean => 'error' in r && r.recoverable === false;

export function shouldShortCircuit(result: HandlerResult): boolean {
  return isBlock(result) || isAbort(result) || isSuspend(result) || isTerminalError(result);
}

interface RegisteredHandler {
  handler: HandlerDefinition;
  kind: "observer" | "interceptor";
  insertionOrder: number;
}

export interface HandlerSnapshot {
  name: string;
  phases?: string[];
  events?: string[];
  priority?: number;
  trust: 0 | 1 | 2 | 3;
  builtin: boolean;
  kind: "observer" | "interceptor";
}

export interface RegistrySnapshot {
  handlers: HandlerSnapshot[];
}

export const BUILTIN_HANDLERS: HandlerDefinition[] = [
  {
    name: "checkpoint",
    events: ["turn:end"],
    priority: 10,
    trust: 3,
    builtin: true,
    handle: async () => ({ ok: true }),
  },
  {
    name: "cost-tracker",
    events: ["llm:response"],
    priority: 20,
    trust: 3,
    builtin: true,
    handle: async () => ({ ok: true }),
  },
  // Real otel-bridge handler registered via registerOTelBridge() from ./otel-bridge.ts.
  // Subscribes to chain:start/end, turn:start/end, phase:before/after events.
  {
    name: "otel-bridge",
    phases: ["context_assembly", "llm_inference", "action_resolution", "tool_execution", "result_observation"],
    events: ["phase:before", "phase:after"],
    priority: 30,
    trust: 3,
    builtin: true,
    handle: async () => ({ ok: true }),
  },
  {
    name: "freeze-guard",
    events: ["phase:before"],
    priority: 5,
    trust: 3,
    builtin: true,
    handle: async () => ({ ok: true }),
  },
];

export function registerBuiltins(engine: HandlerEngine): void {
  for (const h of BUILTIN_HANDLERS) {
    engine.register(h);
  }
}

export class HandlerEngine {
  private handlers: RegisteredHandler[] = [];
  private nextOrder = 0;
  private emitDepth = 0;
  private readonly maxEmitDepth: number;
  private readonly workerRunner?: WorkerHandlerRunner;

  constructor(opts?: { maxEmitDepth?: number; workerRunner?: WorkerHandlerRunner }) {
    this.maxEmitDepth = opts?.maxEmitDepth ?? 10;
    this.workerRunner = opts?.workerRunner;
  }

  register(handler: HandlerDefinition): void {
    this.handlers.push({ handler, kind: "interceptor", insertionOrder: this.nextOrder++ });
  }

  observe(event: string, handler: HandlerFn, priority = 100, name = ""): void {
    this.handlers.push({
      handler: { name, events: [event], priority, trust: 3, builtin: true, handle: handler },
      kind: "observer",
      insertionOrder: this.nextOrder++,
    });
  }

  unregister(name: string): void {
    const rh = this.handlers.find((h) => h.handler.name === name);
    if (!rh) return;
    if (rh.kind === "observer") throw new Error(`Cannot unregister observer "${name}"`);
    if (rh.handler.builtin) throw new Error(`Cannot unregister built-in handler "${name}"`);
    this.handlers = this.handlers.filter((h) => h.handler.name !== name);
  }

  replace(name: string, handler: HandlerDefinition): void {
    const index = this.handlers.findIndex((h) => h.handler.name === name);
    if (index === -1) throw new Error(`Handler "${name}" not found`);
    const rh = this.handlers[index];
    if (rh.kind === "observer") throw new Error(`Cannot replace observer "${name}"`);
    if (rh.handler.builtin) throw new Error(`Cannot replace built-in handler "${name}"`);
    this.handlers[index] = { handler, kind: "interceptor", insertionOrder: rh.insertionOrder };
  }

  getHandlers(event: string, payload?: unknown): HandlerDefinition[] {
    return this.handlers
      .filter((rh) => matchesHandler(rh, event, payload))
      .sort((a, b) => {
        const p = (a.handler.priority ?? 100) - (b.handler.priority ?? 100);
        return p !== 0 ? p : a.insertionOrder - b.insertionOrder;
      })
      .map((rh) => rh.handler);
  }

  serialize(): RegistrySnapshot {
    return {
      handlers: this.handlers.map((rh) => ({
        name: rh.handler.name,
        phases: rh.handler.phases,
        events: rh.handler.events,
        priority: rh.handler.priority,
        trust: rh.handler.trust,
        builtin: rh.handler.builtin ?? false,
        kind: rh.kind,
      })),
    };
  }

  static deserialize(
    snapshot: RegistrySnapshot,
    handlerSources: Record<string, HandlerFn>,
  ): HandlerEngine {
    const engine = new HandlerEngine();
    for (const sh of snapshot.handlers) {
      const handle = handlerSources[sh.name];
      if (!handle) throw new Error(`Handler function not found for "${sh.name}"`);
      if (sh.kind === "observer") {
        const event = sh.events?.[0] ?? "";
        engine.observe(event, handle, sh.priority, sh.name);
      } else {
        engine.register({
          name: sh.name,
          phases: sh.phases as any,
          events: sh.events,
          priority: sh.priority,
          trust: sh.trust,
          builtin: sh.builtin,
          handle,
        });
      }
    }
    return engine;
  }

  async emit(event: string, payload?: unknown): Promise<HandlerResult[]> {
    if (this.emitDepth >= this.maxEmitDepth) {
      throw new Error(
        `HandlerEngine: re-entrancy depth ${this.emitDepth} exceeds limit ${this.maxEmitDepth}`,
      );
    }
    this.emitDepth++;
    try {
      const matching = this.handlers
        .filter((rh) => matchesHandler(rh, event, payload))
        .sort((a, b) => {
          const p = (a.handler.priority ?? 100) - (b.handler.priority ?? 100);
          return p !== 0 ? p : a.insertionOrder - b.insertionOrder;
        });
      const results: HandlerResult[] = [];
      let interceptorsShortCircuited = false;
      for (const rh of matching) {
        if (rh.kind === "interceptor" && interceptorsShortCircuited) continue;
        const shouldUseWorker =
          rh.handler.trust === 2 && this.workerRunner && rh.kind === "interceptor";
        const rawResult = shouldUseWorker
          ? await this.workerRunner!.run(rh.handler, payload)
          : await rh.handler.handle(payload as HandlerContext);
        const parsed = HandlerResultSchema.safeParse(rawResult);
        if (!parsed.success) {
          console.warn(
            `HandlerEngine: handler "${rh.handler.name}" returned invalid HandlerResult`,
            parsed.error.issues,
          );
          results.push({
            error: { message: `Invalid HandlerResult from "${rh.handler.name}"` },
            recoverable: false,
          });
        } else {
          results.push(parsed.data);
        }
        if (rh.kind === "interceptor" && shouldShortCircuit(results[results.length - 1])) {
          interceptorsShortCircuited = true;
        }
      }
      return results;
    } finally {
      this.emitDepth--;
    }
  }
}
