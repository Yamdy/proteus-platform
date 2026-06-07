// @proteus-ai/core — Built-in tools for file system operations
//
// Provides read_file, write_file, and list_dir tools that agents can use
// to interact with the local filesystem.

import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Tool, ToolDefinition, ToolResult, ToolContext } from "../types.js";

// --- read_file ---

export class ReadFileTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "read_file",
    description: "Read the contents of a file from the filesystem",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to read" },
      },
      required: ["path"],
    },
    builtin: true,
  };

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const filePath = String(params.path ?? "");
    if (!filePath) {
      return { output: null, error: { message: "path is required", retryable: false } };
    }

    try {
      const content = await readFile(resolve(filePath), "utf-8");
      return { output: content };
    } catch (err) {
      return {
        output: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      };
    }
  }
}

// --- write_file ---

export class WriteFileTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "write_file",
    description: "Write content to a file on the filesystem",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
    builtin: true,
  };

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const filePath = String(params.path ?? "");
    const content = String(params.content ?? "");

    if (!filePath) {
      return { output: null, error: { message: "path is required", retryable: false } };
    }

    try {
      await writeFile(resolve(filePath), content, "utf-8");
      return { output: { written: true, path: filePath } };
    } catch (err) {
      return {
        output: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      };
    }
  }
}

// --- list_dir ---

export class ListDirTool implements Tool {
  readonly definition: ToolDefinition = {
    name: "list_dir",
    description: "List files and directories in a directory",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the directory to list (defaults to current directory)" },
      },
    },
    builtin: true,
  };

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const dirPath = String(params.path ?? ".");

    try {
      const entries = await readdir(resolve(dirPath), { withFileTypes: true });
      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(resolve(dirPath), entry.name);
          const info = await stat(fullPath).catch(() => null);
          return {
            name: entry.name,
            type: entry.isDirectory() ? "directory" : "file",
            size: info?.size ?? 0,
          };
        }),
      );
      return { output: items };
    } catch (err) {
      return {
        output: null,
        error: {
          message: err instanceof Error ? err.message : String(err),
          retryable: false,
        },
      };
    }
  }
}

// --- registerBuiltInTools ---

export function registerBuiltInTools(registry: { register(tool: Tool): void }): void {
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new ListDirTool());
}
