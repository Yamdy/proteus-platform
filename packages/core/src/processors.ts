import type { HandlerContext } from "./context.js";
import type { HandlerResult, LLMMessage, Tool, ToolResult } from "./types.js";
import type { HandlerEngine } from "./handler-engine.js";
import { sha256 } from "./utils/hash.js";

// --- KV-cache prefix stability ---

export const CACHE_PREFIX_CHANGED_EVENT = "cache:prefix-changed";
export const CACHE_BREAK_EVENT = "context:cache_break";

export interface CachePrefixChangedPayload {
  previousHash: string | null;
  currentHash: string;
  prefixMessages: LLMMessage[];
}

export interface CacheBreakPayload {
  previousHash: string;
  currentHash: string;
  prefixMessages: LLMMessage[];
}

function computePrefixHash(messages: LLMMessage[]): string {
  // Prefix = contiguous system messages at the start of the assembled list
  const prefix: LLMMessage[] = [];
  for (const m of messages) {
    if (m.role !== "system") break;
    prefix.push(m);
  }
  if (prefix.length === 0) return "";
  return sha256(JSON.stringify(prefix));
}

/** Simple token estimation: ~4 chars per token (V1 implementation per D4). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate total tokens in a message list. */
function estimateMessageTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content);
    if (m.thinking) total += estimateTokens(m.thinking);
  }
  return total;
}

// --- ContextAssemblyProcessor ---

export interface ContextAssemblyOptions {
  maxTokens?: number;
  systemPrompt?: string;
}

export class ContextAssemblyProcessor {
  readonly name = "context_assembly";
  private readonly maxTokens: number;
  private readonly systemPrompt: string;
  private _lastPrefixHash: string | null = null;
  private _cachedSystemContent: string | null = null;
  private _chainStarted = false;

  constructor(opts?: ContextAssemblyOptions) {
    this.maxTokens = opts?.maxTokens ?? 4000;
    this.systemPrompt = opts?.systemPrompt ?? "";
  }

  /** Hash of the system-message prefix from the most recent handle() call. */
  get lastPrefixHash(): string | null {
    return this._lastPrefixHash;
  }

  /** Whether the system-message prefix is stable (unchanged since last handle()). */
  get cacheStable(): boolean {
    return this._lastPrefixHash !== null;
  }

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    const messages: LLMMessage[] = [];

    // One-time injection: cache system content at chain start
    if (!this._chainStarted) {
      this._chainStarted = true;
      const systemFragments = ctx.turn.promptFragments.filter((f) => f.role === "system");
      if (systemFragments.length > 0) {
        this._cachedSystemContent = systemFragments.map((f) => f.content).join("\n");
      } else if (this.systemPrompt) {
        this._cachedSystemContent = this.systemPrompt;
      }
    }

    // Use cached system content — pinned at the front for KV-cache stability
    if (this._cachedSystemContent) {
      messages.push({ role: "system", content: this._cachedSystemContent });
    }

    // Working memory
    const wmMessages = ctx.session.workingMemory.getMessages();

    // D4 fix: truncate by estimated token count, not message count
    const wmTokens = estimateMessageTokens(wmMessages);
    if (wmTokens > this.maxTokens) {
      // Drop oldest messages until under budget
      let acc = 0;
      const truncated: LLMMessage[] = [];
      for (let i = wmMessages.length - 1; i >= 0; i--) {
        const msgTokens = estimateTokens(wmMessages[i].content);
        if (acc + msgTokens > this.maxTokens) break;
        acc += msgTokens;
        truncated.unshift(wmMessages[i]);
      }
      messages.push(...truncated);
    } else {
      messages.push(...wmMessages);
    }

    // User prompt fragments — appended at the end
    const userFragments = ctx.turn.promptFragments.filter((f) => f.role === "user");
    for (const f of userFragments) {
      messages.push({ role: "user", content: f.content });
    }

    // KV-cache prefix stability detection
    const currentHash = computePrefixHash(messages);
    const previousHash = this._lastPrefixHash;
    const prefixChanged = previousHash !== currentHash;

    if (prefixChanged) {
      this._lastPrefixHash = currentHash;
      const prefixMessages = messages.filter((m) => m.role === "system");

      // Emit cache:prefix-changed (backward-compatible)
      const changedPayload: CachePrefixChangedPayload = {
        previousHash,
        currentHash,
        prefixMessages,
      };
      void ctx.agent.handlerEngine.emit(CACHE_PREFIX_CHANGED_EVENT, changedPayload);

      // Emit context:cache_break when a previously-stable cache is broken
      if (previousHash !== null) {
        const breakPayload: CacheBreakPayload = {
          previousHash,
          currentHash,
          prefixMessages,
        };
        void ctx.agent.handlerEngine.emit(CACHE_BREAK_EVENT, breakPayload);
      }
    }

    // Set assembled messages on turn context
    for (const m of messages) {
      ctx.turn.addMessage(m);
    }

    return { ok: true };
  }
}

// --- LLMInferenceProcessor ---

export interface LLMInferenceOptions {
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;
}

export class LLMInferenceProcessor {
  readonly name = "llm_inference";
  private readonly onToken?: (token: string) => void;
  private readonly onThinking?: (token: string) => void;

  constructor(opts?: LLMInferenceOptions) {
    this.onToken = opts?.onToken;
    this.onThinking = opts?.onThinking;
  }

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    const tools = ctx.agent.tools;
    const toolDefs = [...tools.values()].map((t) => t.definition);

    // Per-turn callbacks override constructor callbacks (for SSE streaming)
    const onToken = ctx.turn.onToken ?? this.onToken;
    const onThinking = ctx.turn.onThinking ?? this.onThinking;

    let content = "";
    let thinking = "";
    let toolCalls: any[] = [];
    let usage = { promptTokens: 0, completionTokens: 0 };

    // Use streaming to show thinking process
    for await (const chunk of ctx.agent.llm.chatStream(ctx.turn.messages, toolDefs)) {
      if (chunk.thinking) {
        thinking += chunk.thinking;
        onThinking?.(chunk.thinking);
      }
      if (chunk.content) {
        content += chunk.content;
        onToken?.(chunk.content);
      }
      if (chunk.toolCalls && chunk.toolCalls.length > 0) {
        toolCalls = chunk.toolCalls;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }

    // Store assistant response
    ctx.turn.addMessage({
      role: "assistant",
      content,
      thinking,
      toolCalls,
    });

    // Store tool calls for downstream processors
    if (toolCalls.length > 0) {
      ctx.turn.toolCalls = toolCalls;
    }

    // Update cost tracker
    ctx.session.costTracker.addUsage(usage);

    return { ok: true };
  }
}

// --- ActionResolutionProcessor ---

export class ActionResolutionProcessor {
  readonly name = "action_resolution";

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    const toolCalls = ctx.turn.toolCalls;
    if (!toolCalls || toolCalls.length === 0) return { ok: true };

    // Validate all tool calls exist in registry
    for (const tc of toolCalls) {
      if (!ctx.agent.tools.has(tc.name)) {
        return { ok: false, reason: `Tool "${tc.name}" not found in registry` };
      }
    }

    // Store validated actions
    ctx.turn.actions = [...toolCalls];
    return { ok: true };
  }
}

// --- ToolRunner ---

export interface ToolRunner {
  execute(
    tool: Tool,
    params: Record<string, unknown>,
    context: import("./types.js").ToolContext,
  ): Promise<ToolResult>;
}

export class DirectToolRunner implements ToolRunner {
  async execute(
    tool: Tool,
    params: Record<string, unknown>,
    context: import("./types.js").ToolContext,
  ): Promise<ToolResult> {
    return tool.execute(params, context);
  }
}

// --- ToolExecutionProcessor ---

export class ToolExecutionProcessor {
  readonly name = "tool_execution";
  private readonly executionEnv: ToolRunner;

  constructor(executionEnv?: ToolRunner) {
    this.executionEnv = executionEnv ?? new DirectToolRunner();
  }

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    const actions = ctx.turn.actions;
    if (!actions || actions.length === 0) return { ok: true };

    for (const action of actions) {
      const tool = ctx.agent.tools.get(action.name);
      if (!tool) continue;

      try {
        const result = await this.executionEnv.execute(tool, action.arguments, ctx.turn);
        ctx.turn.addToolResult(result);
      } catch (err) {
        ctx.turn.addToolResult({
          output: null,
          error: {
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          },
        });
      }
    }

    return { ok: true };
  }
}

// --- ResultObservationProcessor ---

export class ResultObservationProcessor {
  readonly name = "result_observation";

  async handle(ctx: HandlerContext): Promise<HandlerResult> {
    // Only append messages generated THIS turn (not already in working memory)
    const wmCount = ctx.session.workingMemory.getMessages().length;
    const newMessages = ctx.turn.messages.slice(wmCount);
    for (const msg of newMessages) {
      ctx.session.workingMemory.push(msg);
    }

    // Append tool results as tool messages
    for (const tr of ctx.turn.toolResults) {
      ctx.session.workingMemory.push({
        role: "tool",
        content: typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output),
      });
    }

    return { ok: true };
  }
}

// --- registerBuiltInProcessors ---

export interface RegisterProcessorsOptions extends ContextAssemblyOptions {
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;
  executionEnv?: ToolRunner;
}

export function registerBuiltInProcessors(_engine: HandlerEngine, _opts?: RegisterProcessorsOptions): void {
  // D5: Processors are called directly by the Harness via runProcessor(),
  // NOT through HandlerEngine event handlers. Registering them as handlers
  // would cause double execution (event handler + direct call).
  // See harness.ts: "Processors are called independently by the Harness (not as handlers)"
}
