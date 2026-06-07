// @proteus-ai/core — Memory Zod schemas

import { z } from "zod";

// --- MemoryEntry ---

export const MemoryEntrySchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type MemoryEntryInferred = z.infer<typeof MemoryEntrySchema>;

// --- WorkingMemoryData ---

export const WorkingMemoryDataSchema = z.record(z.unknown());

// --- MemoryThreadMeta ---

export const MemoryThreadMetaSchema = z.object({
  threadId: z.string(),
  sessionId: z.string().optional(),
  name: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MemoryThreadMetaInferred = z.infer<typeof MemoryThreadMetaSchema>;

// --- MemoryConfig ---

export const MemoryHistoryConfigSchema = z.object({
  maxMessages: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  strategy: z.enum(["fifo", "sliding-window"]).optional(),
});

export const MemorySemanticRecallConfigSchema = z.object({
  enabled: z.boolean().optional(),
  topK: z.number().int().positive().optional(),
  threshold: z.number().min(0).max(1).optional(),
});

export const MemoryWorkingMemoryConfigSchema = z.object({
  template: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const MemoryConfigSchema = z.object({
  provider: z.enum(["memory", "sqlite"]),
  history: MemoryHistoryConfigSchema.optional(),
  semanticRecall: MemorySemanticRecallConfigSchema.optional(),
  workingMemory: MemoryWorkingMemoryConfigSchema.optional(),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
