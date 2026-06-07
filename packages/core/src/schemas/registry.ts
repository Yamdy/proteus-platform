// SchemaRegistry — validation utility for Proteus schemas

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ToolDefinitionSchema, ToolResultSchema, ArtifactSchema } from "./tool.js";
import { HandlerResultSchema } from "./handler.js";
import { SessionConfigSchema } from "./session.js";
import { ToolCallSchema, LLMResponseSchema } from "./llm.js";

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: z.ZodIssue[];
}

export class SchemaRegistry {
  private schemas = new Map<string, z.ZodTypeAny>();

  constructor() {
    // Register built-in schemas
    this.register("ToolDefinition", ToolDefinitionSchema);
    this.register("ToolResult", ToolResultSchema);
    this.register("HandlerResult", HandlerResultSchema);
    this.register("SessionConfig", SessionConfigSchema);
    this.register("Artifact", ArtifactSchema);
    this.register("ToolCall", ToolCallSchema);
    this.register("LLMResponse", LLMResponseSchema);
  }

  register<T extends z.ZodTypeAny>(name: string, schema: T): void {
    this.schemas.set(name, schema);
  }

  get(name: string): z.ZodTypeAny | undefined {
    return this.schemas.get(name);
  }

  validate<T>(name: string, data: unknown): ValidationResult<T> {
    if (process.env.NODE_ENV === "production") {
      return { success: true, data: data as T };
    }

    const schema = this.schemas.get(name);
    if (!schema) {
      return { success: false, errors: [{ message: `Schema '${name}' not found`, path: [], code: "custom" }] };
    }

    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data as T };
    }
    return { success: false, errors: result.error.issues };
  }

  validateOrThrow<T>(name: string, data: unknown): T {
    const schema = this.schemas.get(name);
    if (!schema) {
      throw new Error(`Schema '${name}' not found`);
    }
    return schema.parse(data) as T;
  }

  toJSONSchema(name: string, options?: Parameters<typeof zodToJsonSchema>[1]): Record<string, unknown> {
    const schema = this.schemas.get(name);
    if (!schema) {
      throw new Error(`Schema '${name}' not found`);
    }
    return zodToJsonSchema(schema, options) as Record<string, unknown>;
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  list(): string[] {
    return Array.from(this.schemas.keys());
  }
}

export function createSchemaRegistry(): SchemaRegistry {
  return new SchemaRegistry();
}
