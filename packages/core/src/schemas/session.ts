// @proteus-ai/core — SessionConfig Zod schemas
//
// Runtime validation schemas that mirror the TypeScript interfaces in types.ts.
// Use `z.infer<typeof Schema>` to extract the matching TypeScript type.

import { z } from "zod";
import { MemoryConfigSchema } from "../memory/schemas.js";

// --- SessionLLMConfig ---

export const SessionLLMConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  temperature: z.number(),
});

export type SessionLLMConfig = z.infer<typeof SessionLLMConfigSchema>;

// --- CompactionConfig ---

export const CompactionConfigSchema = z.object({
  keepRecentTurns: z.number().min(1).max(50).default(6),
  enabled: z.boolean().default(true),
});

export type CompactionConfig = z.infer<typeof CompactionConfigSchema>;

// --- SessionConfig ---

export const SessionConfigSchema = z.object({
  sessionId: z.string(),
  llm: SessionLLMConfigSchema,
  tools: z.record(z.string(), z.boolean()),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  name: z.string().optional(),
  createdAt: z.number().optional(),
  memory: MemoryConfigSchema.optional(),
  compaction: CompactionConfigSchema.optional(),
});

export type SessionConfigInferred = z.infer<typeof SessionConfigSchema>;
