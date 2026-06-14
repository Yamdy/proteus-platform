import type { McpToolInfo, McpClientOptions, Tool, ToolResult, ToolContext } from "../types.js";
import type { ToolRegistry } from "../tool-registry.js";

/** Error patterns that indicate a transient (retryable) failure. */
const TRANSIENT_ERROR_PATTERNS = [
  "econnreset",
  "etimedout",
  "econnrefused",
  "timeout",
  "network",
  "socket hang up",
  "429",   // rate limit
  "503",   // service unavailable
  "502",   // bad gateway
  "504",   // gateway timeout
];

function isTransientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TRANSIENT_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/**
 * McpClient connects to an external MCP Server and discovers its tools.
 *
 * Transport implementations are injected via the `send` callback.
 * This keeps the core package free of IO dependencies (fs/net).
 */
export class McpClient {
  private readonly serverName: string;
  private readonly send: (method: string, params: unknown) => Promise<unknown>;
  private readonly sleep: (ms: number) => Promise<void>;
  private tools: McpToolInfo[] = [];
  private connected = false;

  constructor(
    opts: McpClientOptions,
    send: (method: string, params: unknown) => Promise<unknown>,
    sleep?: (ms: number) => Promise<void>,
  ) {
    this.serverName = opts.serverName;
    this.send = send;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Connect and discover tools from the remote MCP server. */
  async connect(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      await this.retryWithBackoff(() =>
        this.send("initialize", {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "proteus-mcp-client", version: "0.1.0" },
        }),
      );
      // After initialize, list tools
      const toolsResult = (await this.retryWithBackoff(() =>
        this.send("tools/list", {}),
      )) as {
        tools?: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      };
      this.tools = (toolsResult.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema ?? { type: "object" },
        serverName: this.serverName,
      }));
      this.connected = true;
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Get discovered tools. */
  getTools(): McpToolInfo[] {
    return [...this.tools];
  }

  /** Call a tool on the remote MCP server with retry on transient failures. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    if (!this.connected) {
      return { output: null, error: { message: "MCP client not connected", retryable: false } };
    }
    try {
      const result = (await this.retryWithBackoff(() =>
        this.send("tools/call", { name, arguments: args }),
      )) as {
        content?: Array<{ type: string; text?: string }>;
      };
      // MCP content[] → Proteus output (text extraction)
      const texts = (result.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "");
      return { output: texts.join("\n") };
    } catch (err) {
      return {
        output: null,
        error: {
          message: `MCP tool call failed: ${err instanceof Error ? err.message : String(err)}`,
          retryable: true,
        },
      };
    }
  }

  /**
   * Register all discovered tools into a ToolRegistry.
   * Each tool is wrapped as a standard Proteus Tool.
   */
  registerTools(registry: ToolRegistry): void {
    for (const mcpTool of this.tools) {
      const tool = this.wrapAsTool(mcpTool);
      registry.register(tool);
    }
  }

  /**
   * Retry an async operation with exponential backoff.
   * Only retries transient errors (network/timeout); non-retryable errors throw immediately.
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 100,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && isTransientError(err)) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        } else {
          throw err;
        }
      }
    }
    // Unreachable, but satisfies TypeScript
    throw lastError;
  }

  private wrapAsTool(info: McpToolInfo): Tool {
    const sendFn = this.send;
    return {
      definition: {
        name: `${this.serverName}__${info.name}`,
        description: `[MCP:${this.serverName}] ${info.description}`,
        parameters: info.inputSchema,
      },
      async execute(
        params: Record<string, unknown>,
        _context: ToolContext,
      ): Promise<ToolResult> {
        try {
          const result = (await sendFn("tools/call", {
            name: info.name,
            arguments: params,
          })) as {
            content?: Array<{ type: string; text?: string }>;
          };
          const texts = (result.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "");
          return { output: texts.join("\n") };
        } catch (err) {
          return {
            output: null,
            error: {
              message: `MCP call failed: ${err instanceof Error ? err.message : String(err)}`,
              retryable: false,
            },
          };
        }
      },
    };
  }
}
