import type {
  LLMProvider,
  LLMMessage,
  Tool,
  SessionConfig,
  PromptFragment,
  ToolResult,
  ToolCall,
  HandlerDefinition,
} from "./types.js";
import { sha256 } from "./utils/hash.js";
import type { HandlerResult } from "./types.js";
import { PromptFragmentRegistry } from "./prompt-fragment-registry.js";
import type { MemoryProvider } from "./memory/types.js";
import { createInMemoryProvider } from "./memory/in-memory-provider.js";

// --- HandlerEngineHandle (read-only interface for AgentContext) ---

export interface HandlerEngineHandle {
  getHandlers(event: string, payload?: unknown): HandlerDefinition[];
  emit(event: string, payload?: unknown): Promise<HandlerResult[]>;
}

// --- CostTracker ---

export class CostTracker {
  private promptTokens = 0;
  private completionTokens = 0;

  addUsage(usage: { promptTokens: number; completionTokens: number }): void {
    this.promptTokens += usage.promptTokens;
    this.completionTokens += usage.completionTokens;
  }

  getTotals(): { promptTokens: number; completionTokens: number } {
    return { promptTokens: this.promptTokens, completionTokens: this.completionTokens };
  }
}

// --- WorkingMemory ---

export class WorkingMemory {
  private messages: LLMMessage[] = [];

  push(entry: LLMMessage): void {
    this.messages.push(entry);
  }

  getMessages(): LLMMessage[] {
    return [...this.messages];
  }

  truncate(maxTokens: number): void {
    // Simple truncation: keep last N messages (token counting is provider-specific)
    if (this.messages.length > maxTokens) {
      this.messages = this.messages.slice(-maxTokens);
    }
  }

  clear(): void {
    this.messages = [];
  }
}

// --- AgentContext (process-level) ---

export class AgentContext {
  readonly llm: LLMProvider;
  readonly tools: Map<string, Tool>;
  readonly handlerEngine: HandlerEngineHandle;
  readonly fragmentRegistry: PromptFragmentRegistry;

  constructor(params: {
    llm: LLMProvider;
    tools: Map<string, Tool>;
    handlerEngine?: HandlerEngineHandle;
    fragmentRegistry?: PromptFragmentRegistry;
  }) {
    this.llm = params.llm;
    this.tools = params.tools;
    this.handlerEngine = params.handlerEngine ?? { getHandlers: () => [], emit: async () => [] };
    this.fragmentRegistry = params.fragmentRegistry ?? new PromptFragmentRegistry();
  }
}

// --- SessionContext (per-connection, persisted) ---

export class SessionContext {
  readonly sessionId: string;
  readonly config: SessionConfig;
  readonly workingMemory: WorkingMemory;
  readonly memory: MemoryProvider;
  readonly costTracker: CostTracker;

  constructor(config: SessionConfig, memoryProvider?: MemoryProvider) {
    this.sessionId = config.sessionId;
    this.config = config;
    this.workingMemory = new WorkingMemory();
    this.memory = memoryProvider ?? createInMemoryProvider();
    this.costTracker = new CostTracker();

    // Ensure default thread exists for this session
    this.memory.createThread({
      threadId: config.sessionId,
      sessionId: config.sessionId,
      name: config.name ?? config.sessionId,
      createdAt: config.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  }
}

// --- TurnContext (per-turn, ephemeral) ---

export class TurnContext {
  readonly turnId: string;
  readonly agent: AgentContext;
  readonly session: SessionContext;
  readonly messages: LLMMessage[] = [];
  readonly toolResults: ToolResult[] = [];
  readonly promptFragments: PromptFragment[] = [];
  toolCalls?: ToolCall[];
  actions?: ToolCall[];
  externalInput?: unknown;
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;

  constructor(params: {
    turnId: string;
    agent: AgentContext;
    session: SessionContext;
  }) {
    this.turnId = params.turnId;
    this.agent = params.agent;
    this.session = params.session;
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  addMessage(msg: LLMMessage): void {
    this.messages.push(msg);
  }

  addToolResult(result: ToolResult): void {
    this.toolResults.push(result);
  }

  addPromptFragment(fragment: PromptFragment): void {
    this.promptFragments.push(fragment);
  }
}

// --- HandlerContext (composite passed to handlers) ---

export class HandlerContext {
  readonly agent: AgentContext;
  readonly session: SessionContext;
  readonly turn: TurnContext;

  constructor(params: {
    agent: AgentContext;
    session: SessionContext;
    turn: TurnContext;
  }) {
    this.agent = params.agent;
    this.session = params.session;
    this.turn = params.turn;
  }

  freeze(timestamp?: number): FrozenContext {
    return FrozenContext.from(this, timestamp);
  }
}

// --- FrozenContext (deep-readonly snapshot) ---

export class FrozenContext {
  readonly timestamp: number;
  readonly checksum: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly messages: readonly LLMMessage[];
  readonly toolResults: readonly ToolResult[];
  readonly promptFragments: readonly PromptFragment[];
  readonly costTotals: { promptTokens: number; completionTokens: number };
  readonly resumeReason?: "suspend";
  readonly pendingInput?: unknown;

  private constructor(params: {
    timestamp: number;
    checksum: string;
    sessionId: string;
    turnId: string;
    messages: LLMMessage[];
    toolResults: ToolResult[];
    promptFragments: PromptFragment[];
    costTotals: { promptTokens: number; completionTokens: number };
    resumeReason?: "suspend";
    pendingInput?: unknown;
  }) {
    this.timestamp = params.timestamp;
    this.checksum = params.checksum;
    this.sessionId = params.sessionId;
    this.turnId = params.turnId;
    this.messages = Object.freeze(params.messages);
    this.toolResults = Object.freeze(params.toolResults);
    this.promptFragments = Object.freeze(params.promptFragments);
    this.costTotals = Object.freeze(params.costTotals);
    this.resumeReason = params.resumeReason;
    this.pendingInput = params.pendingInput;
  }

  static from(ctx: HandlerContext, timestamp?: number): FrozenContext {
    const ts = timestamp ?? Date.now();
    const data = {
      sessionId: ctx.session.sessionId,
      turnId: ctx.turn.turnId,
      messages: ctx.turn.messages,
      toolResults: ctx.turn.toolResults,
      promptFragments: ctx.turn.promptFragments,
      costTotals: ctx.session.costTracker.getTotals(),
    };
    const payload = JSON.stringify(data);
    const checksum = sha256(payload);
    return new FrozenContext({ timestamp: ts, checksum, ...data });
  }

  static forSuspend(ctx: HandlerContext, pendingInput?: unknown, timestamp?: number): FrozenContext {
    const base = FrozenContext.from(ctx, timestamp);
    return new FrozenContext({
      timestamp: base.timestamp,
      checksum: base.checksum,
      sessionId: base.sessionId,
      turnId: base.turnId,
      messages: [...base.messages],
      toolResults: [...base.toolResults],
      promptFragments: [...base.promptFragments],
      costTotals: { ...base.costTotals },
      resumeReason: "suspend",
      pendingInput,
    });
  }
}
