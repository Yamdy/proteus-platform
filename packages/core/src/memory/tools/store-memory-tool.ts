import type { Tool, ToolDefinition, ToolResult, ToolContext } from "../../types.js";
import type { HandlerEngineHandle } from "../../context.js";
import type { MemoryProvider, MemoryEntry } from "../types.js";

let storeCounter = 0;

export interface StoreMemoryToolOptions {
  provider: MemoryProvider;
  handlerEngine: HandlerEngineHandle;
}

export class StoreMemoryTool implements Tool {
  readonly definition: ToolDefinition;
  private readonly provider: MemoryProvider;
  private readonly handlerEngine: HandlerEngineHandle;

  constructor(opts: StoreMemoryToolOptions) {
    this.definition = {
      name: "store_memory",
      description: "Persist important information to long-term memory",
      parameters: {},
      builtin: true,
    };
    this.provider = opts.provider;
    this.handlerEngine = opts.handlerEngine;
  }

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const content = String(params.content ?? "");
    const metadata = params.metadata as Record<string, unknown> | undefined;

    const entry: MemoryEntry = {
      id: `store_${Date.now()}_${++storeCounter}`,
      role: "user",
      content,
      timestamp: Date.now(),
      metadata,
    };

    this.provider.addEntry(context.sessionId, entry);

    await this.handlerEngine.emit("memory:store", {
      entryId: entry.id,
      sessionId: context.sessionId,
    });

    return { output: entry };
  }
}
