import type { Tool, ToolDefinition, ToolResult, ToolContext } from "../../types.js";
import type { HandlerEngineHandle } from "../../context.js";
import type { SemanticSearchResult } from "../types.js";
import type { SemanticRecall } from "../semantic-recall.js";

export interface RecallToolOptions {
  semanticRecall: SemanticRecall;
  handlerEngine: HandlerEngineHandle;
}

export class RecallTool implements Tool {
  readonly definition: ToolDefinition;
  private readonly semanticRecall: SemanticRecall;
  private readonly handlerEngine: HandlerEngineHandle;

  constructor(opts: RecallToolOptions) {
    this.definition = {
      name: "recall",
      description: "Search long-term memory for relevant past conversations",
      parameters: {},
      builtin: true,
    };
    this.semanticRecall = opts.semanticRecall;
    this.handlerEngine = opts.handlerEngine;
  }

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = String(params.query ?? "");
    const topK = params.topK != null ? Number(params.topK) : undefined;

    const results: SemanticSearchResult[] = await this.semanticRecall.search(context.sessionId, query, topK);

    await this.handlerEngine.emit("memory:recall", {
      query,
      sessionId: context.sessionId,
      resultCount: results.length,
    });

    return { output: results };
  }
}
