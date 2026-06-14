// @proteus-ai/core/schemas — Zod schemas for trace/span observability types

import { z } from "zod";

export const SpanRecordSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  type: z.string(),
  status: z.enum(["running", "success", "error"]),
  startTime: z.number(),
  endTime: z.number().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
  attributes: z.record(z.unknown()).optional(),
});
export type InferredSpanRecord = z.infer<typeof SpanRecordSchema>;
/** Alias for backward compatibility with Studio lib imports. */
export type SpanRecord = InferredSpanRecord;

export const TraceSummarySchema = z.object({
  traceId: z.string(),
  rootSpanName: z.string(),
  status: z.enum(["ok", "error", "running"]),
  spanCount: z.number(),
  startTime: z.number(),
  endTime: z.number().optional(),
  attributes: z.record(z.unknown()).optional(),
});
export type InferredTraceSummary = z.infer<typeof TraceSummarySchema>;

export function paginatedResponseSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    hasMore: z.boolean(),
  });
}

export const ListTracesArgsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  status: z.enum(["running", "success", "error"]).optional(),
  rootSpanName: z.string().optional(),
  entityName: z.string().optional(),
  entityId: z.string().optional(),
  tags: z
    .string()
    .transform((s) => s.split(",").map((t) => t.trim()).filter(Boolean))
    .optional(),
  sessionId: z.string().optional(),
  mode: z.enum(["delta"]).optional(),
  since: z.coerce.number().optional(),
});
export type InferredListTracesArgs = z.infer<typeof ListTracesArgsSchema>;
