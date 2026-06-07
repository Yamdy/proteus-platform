// Zod schemas for ToolDefinition, ToolResult, and Artifact

import { z } from "zod";

export const ArtifactSchema = z.object({
  type: z.string(),
  data: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  builtin: z.boolean().optional(),
});

export const ToolResultSchema = z
  .object({
    output: z.unknown(),
    artifacts: z.array(ArtifactSchema).optional(),
    error: z
      .object({
        message: z.string(),
        retryable: z.boolean(),
      })
      .optional(),
  })
  .refine((data) => "output" in data, {
    message: "output is required",
    path: ["output"],
  });

export type InferredArtifact = z.infer<typeof ArtifactSchema>;
export type InferredToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type InferredToolResult = z.infer<typeof ToolResultSchema>;
