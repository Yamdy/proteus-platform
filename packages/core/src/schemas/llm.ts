// Zod schemas for LLM responses and tool calls

import { z } from "zod";

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export const LLMResponseSchema = z.object({
  content: z.string(),
  thinking: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  usage: z.object({
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
  }),
  finishReason: z.enum(["stop", "tool_call", "length", "error"]),
});

export type InferredToolCall = z.infer<typeof ToolCallSchema>;
export type InferredLLMResponse = z.infer<typeof LLMResponseSchema>;
