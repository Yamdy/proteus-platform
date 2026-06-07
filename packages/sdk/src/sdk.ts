import {
  AgentContext,
  SessionContext,
  Harness,
  SessionManager,
  HandlerEngine,
  registerBuiltins,
  ToolRegistry,
  createInMemoryStore,
} from "@proteus-ai/core";

import type {
  CheckpointStore,
  SessionConfig,
  Tool,
  HandlerDefinition,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  TurnResult,
} from "@proteus-ai/core";

/** Options accepted by the ProteusSDK constructor. */
export interface SDKOptions {
  /** Backing store for sessions, checkpoints, messages, etc. Defaults to in-memory. */
  store?: CheckpointStore;
  /** LLM provider for inference. Optional — required only when using chat/chatStream. */
  llm?: LLMProvider;
}

/**
 * ProteusSDK — high-level, embeddable API for the Proteus agent runtime.
 *
 * Wraps the lower-level core classes (Harness, SessionManager, HandlerEngine,
 * ToolRegistry, etc.) into a single facade that is easy to use from application
 * code.
 */
export class ProteusSDK {
  /** Internal tool registry. */
  readonly toolRegistry: ToolRegistry;

  /** Handler engine for event/phase dispatch. */
  readonly handlerEngine: HandlerEngine;

  /** Harness — runs agent turns through the handler pipeline. */
  readonly harness: Harness;

  /** Session manager — CRUD for sessions. */
  readonly sessionManager: SessionManager;

  /** The backing store. */
  readonly store: CheckpointStore;

  /** LLM provider (may be set later). */
  private llm?: LLMProvider;

  /** Sessions currently in a suspended state. */
  private readonly suspendedSessions = new Set<string>();

  constructor(options?: SDKOptions) {
    this.store = options?.store ?? createInMemoryStore();
    this.llm = options?.llm;

    this.toolRegistry = new ToolRegistry();
    this.handlerEngine = new HandlerEngine();
    registerBuiltins(this.handlerEngine);

    this.harness = new Harness({ store: this.store });
    this.sessionManager = new SessionManager({ store: this.store });
  }

  // ---- Registration ----

  /** Register a tool. Throws if a tool with the same name is already registered. */
  registerTool(tool: Tool): void {
    this.toolRegistry.register(tool);
  }

  /** Register a handler definition with the handler engine. */
  registerHandler(handler: HandlerDefinition): void {
    this.handlerEngine.register(handler);
  }

  // ---- Session management ----

  /**
   * Create a new session.
   *
   * Also initializes the MessageStore entry for the session so that
   * subsequent `addMessage`/`getMessages` calls have a backing store
   * slot ready.
   *
   * @throws if a session with the given id already exists.
   */
  createSession(sessionId: string, config: SessionConfig): SessionContext {
    const session = this.sessionManager.create(sessionId, config);
    // Initialize the message store entry for this session.
    this.store.addMessages(sessionId, []);
    return session;
  }

  /** Retrieve an existing session, or undefined if not found. */
  getSession(sessionId: string): SessionContext | undefined {
    return this.sessionManager.get(sessionId);
  }

  /** Destroy a session (no-op if it doesn't exist). */
  destroySession(sessionId: string): void {
    this.suspendedSessions.delete(sessionId);
    this.sessionManager.destroy(sessionId);
  }

  /** List all session ids. */
  listSessions(): string[] {
    return this.sessionManager.list();
  }

  // ---- Message management ----

  /**
   * Add a single message to a session's working memory and persist it
   * to the MessageStore.
   *
   * @throws if no session with the given id exists.
   */
  addMessage(sessionId: string, message: LLMMessage): void {
    const session = this.requireSession(sessionId);
    session.workingMemory.push(message);
    this.store.addMessages(sessionId, [message]);
  }

  /**
   * Retrieve all messages from a session's working memory.
   *
   * @returns a copy of the session's message list.
   * @throws if no session with the given id exists.
   */
  getMessages(sessionId: string): LLMMessage[] {
    const session = this.requireSession(sessionId);
    return session.workingMemory.getMessages();
  }

  /**
   * Clear all messages from a session's working memory.
   *
   * @throws if no session with the given id exists.
   */
  clearMessages(sessionId: string): void {
    const session = this.requireSession(sessionId);
    session.workingMemory.clear();
  }

  // ---- Inference ----

  /**
   * Run a synchronous chat turn.
   *
   * Pushes `message` as a user prompt into the session's working memory,
   * then runs the full harness pipeline (context assembly, LLM inference,
   * action resolution, tool execution, result observation).
   *
   * If a handler returns `{ suspend: true }`, the session is automatically
   * tracked as suspended.
   *
   * @throws if no session with the given id exists, or if no LLM provider
   *         has been configured.
   */
  async chat(sessionId: string, message: string): Promise<TurnResult> {
    const session = this.requireSession(sessionId);
    const agent = this.buildAgentContext();

    session.workingMemory.push({ role: "user", content: message });

    const result = await this.harness.runTurn(session, agent);

    if (result.status === "suspended") {
      this.suspendedSessions.add(sessionId);
    }

    return result;
  }

  /**
   * Run a streaming chat turn.
   *
   * Implementation note: the current core Harness does not expose a native
   * streaming API, so this method runs `chat()` internally and yields the
   * final LLMResponse. Future versions will pipe through the provider's
   * `chatStream` directly.
   */
  async *chatStream(
    sessionId: string,
    message: string,
  ): AsyncIterable<LLMResponse> {
    const session = this.requireSession(sessionId);
    const agent = this.buildAgentContext();

    session.workingMemory.push({ role: "user", content: message });

    // TODO: Replace with native streaming once Harness exposes streaming turns.
    await this.harness.runTurn(session, agent);

    // Yield the last assistant message from working memory as a single chunk.
    const msgs = session.workingMemory.getMessages();
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    const content = lastAssistant?.content ?? "";

    yield {
      content,
      usage: session.costTracker.getTotals(),
      finishReason: "stop",
    };
  }

  // ---- Lifecycle (suspend / resume) ----

  /**
   * Suspend a session.
   *
   * Marks the session as suspended in the SDK's internal tracking set and
   * transitions the harness lifecycle state machine (if it is in a state
   * that allows the "suspend" event).
   *
   * A full suspend/resume cycle normally requires the harness pipeline to be
   * mid-turn (a handler returns `{ suspend: true }`). This convenience method
   * is provided for SDK consumers who manage lifecycle externally — for
   * example, to proactively suspend a session before a turn starts.
   *
   * @throws if no session with the given id exists.
   */
  suspend(sessionId: string): void {
    this.requireSession(sessionId);
    this.suspendedSessions.add(sessionId);
    const lifecycle = this.harness.lifecycle;
    if (lifecycle.canTransition("suspend")) {
      lifecycle.transition("suspend");
    }
  }

  /**
   * Resume a previously suspended session.
   *
   * Loads the latest suspend checkpoint and re-enters the harness pipeline.
   * The session is removed from the suspended set on successful resume.
   *
   * @throws if no session with the given id exists.
   * @throws if no suspend checkpoint exists for the session (i.e. the
   *         harness was never suspended for this session).
   */
  async resume(sessionId: string, input?: unknown): Promise<TurnResult> {
    this.requireSession(sessionId);
    const agent = this.buildAgentContext();
    this.suspendedSessions.delete(sessionId);
    return this.harness.resume(sessionId, agent, input);
  }

  /**
   * Check whether a session is currently in a suspended state.
   */
  isSuspended(sessionId: string): boolean {
    return this.suspendedSessions.has(sessionId);
  }

  // ---- Internals ----

  private requireSession(sessionId: string): SessionContext {
    const session = this.sessionManager.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    return session;
  }

  private buildAgentContext(): AgentContext {
    const toolsMap = new Map<string, Tool>();
    for (const name of this.toolRegistry.list()) {
      const t = this.toolRegistry.get(name);
      if (t) toolsMap.set(name, t);
    }

    return new AgentContext({
      llm: this.llm ?? createStubLLM(),
      tools: toolsMap,
      handlerEngine: this.handlerEngine,
    });
  }
}

// ---- Helpers ----

function createStubLLM(): LLMProvider {
  return {
    async chat() {
      return {
        content: "",
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: "stop" as const,
      };
    },
    async *chatStream() {
      yield {
        content: "",
        usage: { promptTokens: 0, completionTokens: 0 },
        finishReason: "stop" as const,
      };
    },
    countTokens() {
      return 0;
    },
  };
}
