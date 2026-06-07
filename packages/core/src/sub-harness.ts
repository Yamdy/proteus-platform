import { Harness, type HarnessOptions, type TurnResult, type ChainResult, type ChainOptions, type TurnCallbacks } from "./harness.js";
import { SessionContext, WorkingMemory } from "./context.js";
import type { AgentContext, CostTracker } from "./context.js";
import type { IsolationMode, SubHarnessOptions, LLMMessage } from "./types.js";
import type { CostAttributionTracker } from "./cost-tracker.js";

/**
 * SubHarness: A harness that runs under a parent agent with configurable context isolation.
 *
 * Three isolation modes:
 * - full:    Fresh SessionContext, no parent state inherited
 * - shared:  Inherits parent WorkingMemory (same message history)
 * - summary: Compresses parent context into a system summary message
 *
 * Supports:
 * - AbortSignal inheritance from parent
 * - Cost attribution back to parent agent session
 */
export class SubHarness extends Harness {
  readonly isolation: IsolationMode;
  private readonly parentContext?: SessionContext;
  private readonly abortSignal?: AbortSignal;
  private readonly costAttribution?: { parentSessionId: string };
  private readonly costAttributionTracker?: CostAttributionTracker;
  private readonly agentId?: string;
  private readonly parentAgentId?: string;
  private childSession?: SessionContext;
  private attributedPromptTokens = 0;
  private attributedCompletionTokens = 0;

  constructor(harnessOpts: HarnessOptions, subOpts: SubHarnessOptions & { agentId?: string; parentAgentId?: string }) {
    super(harnessOpts);
    this.isolation = subOpts.isolation;
    this.parentContext = subOpts.parentContext;
    this.abortSignal = subOpts.abortSignal;
    this.costAttribution = subOpts.costAttribution;
    this.costAttributionTracker = subOpts.costTracker;
    this.agentId = subOpts.agentId;
    this.parentAgentId = subOpts.parentAgentId;
  }

  /**
   * Build a SessionContext for the sub-harness based on isolation mode.
   */
  buildSession(childSessionId: string): SessionContext {
    switch (this.isolation) {
      case "full":
        return this.buildFullSession(childSessionId);
      case "shared":
        return this.buildSharedSession(childSessionId);
      case "summary":
        return this.buildSummarySession(childSessionId);
    }
  }

  /**
   * Run a single turn with the sub-harness, handling cost attribution.
   */
  async runTurn(session: SessionContext, agent: AgentContext, opts?: { callbacks?: TurnCallbacks }): Promise<TurnResult> {
    this.checkAbort();
    const result = await super.runTurn(session, agent, opts);
    this.attributeCost(session);
    return result;
  }

  /**
   * Run a chain with abort signal propagation and cost attribution.
   */
  async runChain(session: SessionContext, agent: AgentContext, opts?: ChainOptions): Promise<ChainResult> {
    const mergedOpts: ChainOptions = {
      ...opts,
      abortSignal: this.abortSignal ?? opts?.abortSignal,
    };
    const result = await super.runChain(session, agent, mergedOpts);
    this.attributeCost(session);
    return result;
  }

  /**
   * Get the child session (after buildSession has been called).
   */
  get session(): SessionContext | undefined {
    return this.childSession;
  }

  // --- Private helpers ---

  private buildFullSession(childSessionId: string): SessionContext {
    const session = new SessionContext({
      sessionId: childSessionId,
      llm: { provider: "unknown", model: "unknown", temperature: 0 },
      tools: {},
      logLevel: "info",
    });
    this.childSession = session;
    return session;
  }

  private buildSharedSession(childSessionId: string): SessionContext {
    const session = new SessionContext({
      sessionId: childSessionId,
      llm: { provider: "unknown", model: "unknown", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    // Inherit parent WorkingMemory by copying messages
    if (this.parentContext) {
      const parentMessages = this.parentContext.workingMemory.getMessages();
      for (const msg of parentMessages) {
        session.workingMemory.push(msg);
      }
    }

    this.childSession = session;
    return session;
  }

  private buildSummarySession(childSessionId: string): SessionContext {
    const session = new SessionContext({
      sessionId: childSessionId,
      llm: { provider: "unknown", model: "unknown", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    // Compress parent context into a summary system message
    if (this.parentContext) {
      const parentMessages = this.parentContext.workingMemory.getMessages();
      if (parentMessages.length > 0) {
        const summary = this.summarizeMessages(parentMessages);
        session.workingMemory.push({
          role: "system",
          content: summary,
        });
      }
    }

    this.childSession = session;
    return session;
  }

  /**
   * Simple message summarization: extracts role + content preview for each message.
   * A production implementation would call an LLM for true summarization.
   */
  private summarizeMessages(messages: LLMMessage[]): string {
    const lines = messages.map((msg, i) => {
      const preview = msg.content.length > 200
        ? msg.content.slice(0, 200) + "..."
        : msg.content;
      return `[${i + 1}] ${msg.role}: ${preview}`;
    });
    return `Parent context summary (${messages.length} messages):\n${lines.join("\n")}`;
  }

  private checkAbort(): void {
    if (this.abortSignal?.aborted) {
      throw new Error("SubHarness aborted by parent signal");
    }
  }

  private attributeCost(childSession: SessionContext): void {
    if (!this.costAttribution) return;

    const childTotals = childSession.costTracker.getTotals();
    const deltaPrompt = childTotals.promptTokens - this.attributedPromptTokens;
    const deltaCompletion = childTotals.completionTokens - this.attributedCompletionTokens;

    if (deltaPrompt > 0 || deltaCompletion > 0) {
      if (this.parentContext) {
        this.parentContext.costTracker.addUsage({
          promptTokens: deltaPrompt,
          completionTokens: deltaCompletion,
        });
      }

      // Record to CostAttributionTracker if available
      if (this.costAttributionTracker && this.agentId) {
        const totalTokens = deltaPrompt + deltaCompletion;
        // Estimate cost: $0.001 per 1000 tokens as a baseline
        const estimatedCost = totalTokens / 1000 * 0.001;
        this.costAttributionTracker.trackCost({
          agentId: this.agentId,
          tokens: totalTokens,
          cost: estimatedCost,
          parentAgentId: this.parentAgentId,
        });
      }

      this.attributedPromptTokens = childTotals.promptTokens;
      this.attributedCompletionTokens = childTotals.completionTokens;
    }
  }
}
