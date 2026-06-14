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

  describe("retryWithBackoff (callTool)", () => {
    /** A no-op sleep for fast tests. */
    const noSleep = async () => {};

    it("should retry on transient failure and succeed", async () => {
      let callCount = 0;
      const flakySend = async (method: string, params: unknown) => {
        if (method === "tools/call") {
          callCount++;
          if (callCount <= 2) {
            throw new Error("ECONNRESET: connection reset");
          }
          return { content: [{ type: "text", text: "success" }] };
        }
        return createMockSend().send(method, params);
      };
      const c = new McpClient(opts, flakySend, noSleep);
      await c.connect();
      const result = await c.callTool("get_weather", { city: "Beijing" });
      expect(result.output).toBe("success");
      expect(callCount).toBe(3); // 2 failures + 1 success
    });

    it("should return error after exhausting retries on transient failure", async () => {
      const alwaysFail = async (method: string) => {
        if (method === "tools/call") {
          throw new Error("ETIMEDOUT: connection timed out");
        }
        return createMockSend().send(method, {});
      };
      const c = new McpClient(opts, alwaysFail, noSleep);
      await c.connect();
      const result = await c.callTool("get_weather", { city: "Beijing" });
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("ETIMEDOUT");
      expect(result.error!.retryable).toBe(true);
    });

    it("should NOT retry non-retryable errors", async () => {
      let callCount = 0;
      const notFoundSend = async (method: string, params: unknown) => {
        if (method === "tools/call") {
          callCount++;
          throw new Error("method not found: tools/call");
        }
        return createMockSend().send(method, params);
      };
      const c = new McpClient(opts, notFoundSend, noSleep);
      await c.connect();
      const result = await c.callTool("get_weather", { city: "Beijing" });
      expect(result.error).toBeDefined();
      expect(result.error!.retryable).toBe(true); // error result always marks retryable
      expect(callCount).toBe(1); // no retries for non-transient error
    });

    it("should NOT retry validation errors", async () => {
      let callCount = 0;
      const validationFailSend = async (method: string, params: unknown) => {
        if (method === "tools/call") {
          callCount++;
          throw new Error("invalid params: missing required field 'city'");
        }
        return createMockSend().send(method, params);
      };
      const c = new McpClient(opts, validationFailSend, noSleep);
      await c.connect();
      const result = await c.callTool("get_weather", { city: "" });
      expect(result.error).toBeDefined();
      expect(callCount).toBe(1); // no retries for validation error
    });
  });

  describe("retryWithBackoff (connect)", () => {
    const noSleep = async () => {};

    it("should retry initialize on transient failure and succeed", async () => {
      let initCount = 0;
      const mock = createMockSend();
      const flakyInit = async (method: string, params: unknown) => {
        if (method === "initialize") {
          initCount++;
          if (initCount <= 1) {
            throw new Error("ECONNREFUSED: connection refused");
          }
        }
        return mock.send(method, params);
      };
      const c = new McpClient(opts, flakyInit, noSleep);
      const result = await c.connect();
      expect(result.ok).toBe(true);
      expect(initCount).toBe(2); // 1 failure + 1 success
    });

    it("should return error after exhausting connect retries", async () => {
      const alwaysFail = async (method: string) => {
        if (method === "initialize") {
          throw new Error("ECONNREFUSED: connection refused");
        }
        return {};
      };
      const c = new McpClient(opts, alwaysFail, noSleep);
      const result = await c.connect();
      expect(result.ok).toBe(false);
      expect((result as any).reason).toContain("ECONNREFUSED");
    });

    it("should NOT retry non-transient connect errors", async () => {
      let initCount = 0;
      const badProtocol = async (method: string) => {
        if (method === "initialize") {
          initCount++;
          throw new Error("unsupported protocol version");
        }
        return {};
      };
      const c = new McpClient(opts, badProtocol, noSleep);
      const result = await c.connect();
      expect(result.ok).toBe(false);
      expect(initCount).toBe(1); // no retry
    });
  });
});
