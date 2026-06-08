import type { McpServerInfo } from "../types.js";
import type { ToolRegistry } from "../tool-registry.js";

/**
 * McpServer exposes local ToolRegistry tools as an MCP server.
 *
 * It handles JSON-RPC method dispatch and delegates to ToolRegistry.
 * Transport is injected via the `onRequest` callback pattern.
 */
export class McpServer {
  readonly serverInfo: McpServerInfo;
  private readonly registry: ToolRegistry;

  constructor(
    serverInfo: McpServerInfo,
    registry: ToolRegistry,
  ) {
    this.serverInfo = serverInfo;
    this.registry = registry;
  }

  /**
   * Handle an incoming MCP JSON-RPC request.
   * Returns the result to send back.
   */
  async handleRequest(
    method: string,
    params: unknown,
    id?: number | string,
  ): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.handleInitialize();
      case "tools/list":
        return this.handleToolsList();
      case "tools/call":
        return this.handleToolsCall(params as { name: string; arguments?: Record<string, unknown> });
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  private handleInitialize() {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: this.serverInfo,
    };
  }

  private handleToolsList() {
    const definitions = this.registry.getDefinitions();
    return {
      tools: definitions.map((d) => ({
        name: d.name,
        description: d.description,
        inputSchema: d.parameters ?? { type: "object" },
      })),
    };
  }

  private async handleToolsCall(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) {
    const { name, arguments: args = {} } = params;
    try {
      const result = await this.registry.execute(name, args, {
        turnId: "mcp-server",
        sessionId: "mcp-server",
      });
      // Proteus ToolResult.output → MCP content[]
      const text = typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output);
      return {
        content: [{ type: "text", text }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }
}
