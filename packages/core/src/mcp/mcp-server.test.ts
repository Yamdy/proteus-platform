import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "./mcp-server.js";
import { ToolRegistry } from "../tool-registry.js";
import type { Tool } from "../types.js";

function makeTool(name: string, description = "test tool"): Tool {
  return {
    definition: {
      name,
      description,
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
      },
    },
    async execute(params) {
      return { output: `echo: ${(params as any).input ?? ""}` };
    },
  };
}

describe("McpServer", () => {
  let registry: ToolRegistry;
  let server: McpServer;

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(makeTool("greet", "Say hello"));
    registry.register(makeTool("calculate", "Do math"));
    server = new McpServer(
      { name: "proteus", version: "0.1.0", capabilities: { tools: true } },
      registry,
    );
  });

  describe("initialize", () => {
    it("should return server info and capabilities", async () => {
      const result = (await server.handleRequest("initialize", {})) as any;
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.capabilities.tools).toEqual({});
      expect(result.serverInfo.name).toBe("proteus");
    });
  });

  describe("tools/list", () => {
    it("should list all registered tools", async () => {
      const result = (await server.handleRequest("tools/list", {})) as any;
      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].name).toBe("greet");
      expect(result.tools[0].description).toBe("Say hello");
    });

    it("should include inputSchema", async () => {
      const result = (await server.handleRequest("tools/list", {})) as any;
      expect(result.tools[0].inputSchema).toBeDefined();
    });
  });

  describe("tools/call", () => {
    it("should execute a tool and return result", async () => {
      const result = (await server.handleRequest("tools/call", {
        name: "greet",
        arguments: { input: "world" },
      })) as any;
      expect(result.content[0].text).toBe("echo: world");
    });

    it("should handle missing arguments", async () => {
      const result = (await server.handleRequest("tools/call", {
        name: "greet",
      })) as any;
      expect(result.content[0].text).toBe("echo: ");
    });

    it("should return error for unknown tool", async () => {
      const result = (await server.handleRequest("tools/call", {
        name: "nonexistent",
        arguments: {},
      })) as any;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Tool execution failed");
    });
  });

  describe("unknown method", () => {
    it("should return method not found error", async () => {
      const result = (await server.handleRequest("unknown/method", {}, 1)) as any;
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toContain("Method not found");
    });
  });

  describe("client-server round trip", () => {
    it("should list tools and call them through McpServer", async () => {
      // List tools
      const listResult = (await server.handleRequest("tools/list", {})) as any;
      const toolNames = listResult.tools.map((t: any) => t.name);
      expect(toolNames).toContain("greet");
      expect(toolNames).toContain("calculate");

      // Call tool
      const callResult = (await server.handleRequest("tools/call", {
        name: "calculate",
        arguments: { input: "42" },
      })) as any;
      expect(callResult.content[0].text).toBe("echo: 42");
    });
  });
});
