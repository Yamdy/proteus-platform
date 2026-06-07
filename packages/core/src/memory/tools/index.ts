import type { Tool } from "../../types.js";
import type { HandlerEngineHandle } from "../../context.js";
import type { MemoryProvider } from "../types.js";
import type { SemanticRecall } from "../semantic-recall.js";
import { RecallTool } from "./recall-tool.js";
import { StoreMemoryTool } from "./store-memory-tool.js";

export function createMemoryTools(
  provider: MemoryProvider,
  semanticRecall: SemanticRecall,
  handlerEngine: HandlerEngineHandle,
): Tool[] {
  return [
    new RecallTool({ semanticRecall, handlerEngine }),
    new StoreMemoryTool({ provider, handlerEngine }),
  ];
}
