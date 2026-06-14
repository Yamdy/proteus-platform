// @proteus-ai/core/schemas — Zod validation schemas for core types

export { HandlerResultSchema } from "./handler.js";
export type { InferredHandlerResult } from "./handler.js";

export { SessionConfigSchema, SessionLLMConfigSchema, CompactionConfigSchema } from "./session.js";
export type { SessionConfigInferred, SessionLLMConfig, CompactionConfig } from "./session.js";

export { ToolDefinitionSchema, ToolResultSchema, ArtifactSchema } from "./tool.js";
export type { InferredToolDefinition, InferredToolResult, InferredArtifact } from "./tool.js";

export { ToolCallSchema, LLMResponseSchema } from "./llm.js";
export type { InferredToolCall, InferredLLMResponse } from "./llm.js";

export { SchemaRegistry, createSchemaRegistry } from "./registry.js";
export type { ValidationResult } from "./registry.js";

export { SpanRecordSchema, TraceSummarySchema, ListTracesArgsSchema, paginatedResponseSchema } from "./traces.js";
export type { InferredSpanRecord, SpanRecord, InferredTraceSummary, InferredListTracesArgs } from "./traces.js";
