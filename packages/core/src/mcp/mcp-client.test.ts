import { describe, it, expect, beforeEach } from "vitest";
import { McpClient } from "./mcp-client.js";
import { ToolRegistry } from "../tool-registry.js";
import type { McpClientOptions } from "../types.js";

const opts: McpClientOptions = {
  serverName: "test-server",
  transport: "stdio",
  command: "echo",
};

/** Mock send function that simulates MCP protocol responses. */
function createMockSend() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const send = async (method: string, params: unknown) => {
    calls.push({ method, params });
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "test-server", version: "1.0.0" },
        };
      case "tools/list":
        return {
          tools: [
            {
              name: "get_weather",
              description: "Get current weather for a city",
              inputSchema: {
                type: "object",
                properties: { city: { type: "string" } },
                required: ["city"],
              },
            },
            {
              name: "search",
              description: "Search the web",
              inputSchema: { type: "object", properties: { query: { type: "string" } } },
            },
          ],
        };
      case "tools/call":
        return {
          content: [{ type: "text", text: `Result for ${(params as any).name}` }],
        };
      default:
        return {};
    }
  };
  return { send, calls };
}

describe("McpClient", () => {
  let client: McpClient;
  let mockSend: ReturnType<typeof createMockSend>;

  beforeEach(() => {
    mockSend = createMockSend();
    client = new McpClient(opts, mockSend.send);
  });

  describe("connect", () => {
    it("should connect and discover tools", async () => {
      const result = await client.connect();
      expect(result.ok).toBe(true);
      expect(client.getTools()).toHaveLength(2);
    });

    it("should call initialize then tools/list", async () => {
      await client.connect();
      expect(mockSend.calls[0].method).toBe("initialize");
      expect(mockSend.calls[1].method).toBe("tools/list");
    });

    it("should handle connection errors", async () => {
      const failClient = new McpClient(opts, async () => {
        throw new Error("connection refused");
      });
      const result = await failClient.connect();
      expect(result.ok).toBe(false);
      expect((result as any).reason).toContain("connection refused");
    });
  });

  describe("callTool", () => {
    it("should call tool on remote server", async () => {
      await client.connect();
      const result = await client.callTool("get_weather", { city: "Beijing" });
      expect(result.output).toContain("get_weather");
    });

    it("should return error when not connected", async () => {
      const result = await client.callTool("get_weather", { city: "Beijing" });
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("not connected");
    });
  });

  describe("registerTools", () => {
    it("should register MCP tools into ToolRegistry", async () => {
      await client.connect();
      const registry = new ToolRegistry();
      client.registerTools(registry);

      const names = registry.list();
      expect(names).toContain("test-server__get_weather");
      expect(names).toContain("test-server__search");
    });

    it("should wrap MCP tool with prefixed name", async () => {
      await client.connect();
      const registry = new ToolRegistry();
      client.registerTools(registry);

      const tool = registry.get("test-server__get_weather");
      expect(tool).toBeDefined();
      expect(tool!.definition.description).toContain("[MCP:test-server]");
    });

    it("should execute wrapped tool through registry", async () => {
      await client.connect();
      const registry = new ToolRegistry();
      client.registerTools(registry);

      const result = await registry.execute(
        "test-server__get_weather",
        { city: "Shanghai" },
        { turnId: "t1", sessionId: "s1" },
      );
      expect(result.output).toContain("get_weather");
    });
  });

  describe("getTools", () => {
    it("should return empty array before connect", () => {
      expect(client.getTools()).toEqual([]);
    });

    it("should return tool info after connect", async () => {
      await client.connect();
      const tools = client.getTools();
      expect(tools[0].name).toBe("get_weather");
      expect(tools[0].serverName).toBe("test-server");
    });
  });
});
