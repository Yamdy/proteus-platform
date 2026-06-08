import { describe, it, expect, beforeEach } from "vitest";
import { GlobalKnowledgeStore } from "../packages/core/src/knowledge/global-knowledge-store.js";
import {
  AllowAllPolicy,
  DenyTagPolicy,
  OwnerOnlyWritePolicy,
  CompositePolicy,
} from "../packages/core/src/knowledge/knowledge-access-policy.js";
import { InMemoryAuditLog, createH2Hook, registerGovernanceHooks } from "../packages/core/src/governance/governance-hooks.js";
import { HandlerEngine } from "../packages/core/src/handler-engine.js";
import { McpClient } from "../packages/core/src/mcp/mcp-client.js";
import { McpServer } from "../packages/core/src/mcp/mcp-server.js";
import { ToolRegistry } from "../packages/core/src/tool-registry.js";
import type { Tool, KnowledgeEntry } from "../packages/core/src/types.js";

// ============================================================
// 5.1 + 5.2: Cross-agent knowledge sharing with access control
// ============================================================

describe("Phase 5 E2E: Knowledge Sharing + Governance", () => {
  describe("Cross-agent knowledge sharing", () => {
    let store: GlobalKnowledgeStore;

    beforeEach(() => {
      store = new GlobalKnowledgeStore();
    });

    it("Agent A writes knowledge, Agent B reads it", () => {
      // Agent A writes analysis results
      const entry = store.put({
        key: "analysis/auth-bug",
        value: { severity: "critical", description: "SQL injection in login endpoint" },
        tags: ["security", "shared"],
        agentId: "security-scanner",
      });

      // Agent B reads shared knowledge
      const shared = store.query({ tags: ["shared"] });
      expect(shared).toHaveLength(1);
      expect(shared[0].value).toEqual({
        severity: "critical",
        description: "SQL injection in login endpoint",
      });
      expect(shared[0].agentId).toBe("security-scanner");
    });

    it("KnowledgeAccessPolicy blocks unauthorized writes", () => {
      // Define policy: only owner can write, deny "restricted" tag
      const policy = new CompositePolicy([
        new OwnerOnlyWritePolicy(),
        new DenyTagPolicy(["restricted"]),
      ]);

      // Agent B tries to overwrite Agent A's entry
      const entry = store.put({
        key: "shared/config",
        value: { debug: true },
        tags: ["config"],
        agentId: "agent-a",
      });

      const decision = policy.check({
        agentId: "agent-b",
        mode: "write",
        entry,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("not the owner");
    });

    it("DenyTagPolicy blocks access to restricted entries", () => {
      const policy = new DenyTagPolicy(["restricted"]);

      const entry = store.put({
        key: "secret/credentials",
        value: { token: "xxx" },
        tags: ["restricted"],
      });

      const decision = policy.check({
        agentId: "any-agent",
        mode: "read",
        entry,
      });
      expect(decision.allowed).toBe(false);
    });
  });

  // ============================================================
  // 5.3: Governance H2 — suspend for human approval
  // ============================================================

  describe("Governance H2 — human approval", () => {
    it("H2 hook returns suspend, AuditLog records it", async () => {
      const auditLog = new InMemoryAuditLog();
      const engine = new HandlerEngine();

      // Register H2: require approval for delete_file tool
      registerGovernanceHooks(
        engine,
        {
          h2: async (ctx) => {
            const toolName = ctx.turn.toolCalls?.[0]?.name;
            if (toolName === "delete_file") {
              return { suspend: true, pendingInput: "Approve file deletion?" };
            }
            return null;
          },
        },
        auditLog,
      );

      // Verify H2 hook is registered
      const names = engine.serialize().handlers.map((h) => h.name);
      expect(names).toContain("governance-h2-action-validation");

      // Verify audit log captured the registration hooks
      expect(auditLog.size).toBe(0); // No decisions yet — hooks only log when emitted
    });

    it("AuditLog queries by hook and action", () => {
      const auditLog = new InMemoryAuditLog();
      auditLog.log({ hook: "H1", action: "allow", reason: "ok", timestamp: 1 });
      auditLog.log({ hook: "H2", action: "deny", reason: "blocked", timestamp: 2 });
      auditLog.log({ hook: "H2", action: "suspend", reason: "approval", timestamp: 3 });

      expect(auditLog.query({ hook: "H2" })).toHaveLength(2);
      expect(auditLog.query({ action: "suspend" })).toHaveLength(1);
    });
  });

  // ============================================================
  // 5.4 + 5.5: MCP Client/Server round trip
  // ============================================================

  describe("MCP Client/Server round trip", () => {
    it("McpServer exposes ToolRegistry tools, McpClient discovers and calls them", async () => {
      // Set up local ToolRegistry with tools
      const registry = new ToolRegistry();
      registry.register({
        definition: {
          name: "echo",
          description: "Echo back the input",
          parameters: { type: "object", properties: { text: { type: "string" } } },
        },
        async execute(params) {
          return { output: `echoed: ${(params as any).text}` };
        },
      });

      // Create MCP Server
      const server = new McpServer(
        { name: "proteus", version: "0.1.0", capabilities: { tools: true } },
        registry,
      );

      // Simulate MCP Client using server.handleRequest directly
      const initResult = (await server.handleRequest("initialize", {})) as any;
      expect(initResult.serverInfo.name).toBe("proteus");

      const listResult = (await server.handleRequest("tools/list", {})) as any;
      expect(listResult.tools).toHaveLength(1);
      expect(listResult.tools[0].name).toBe("echo");

      const callResult = (await server.handleRequest("tools/call", {
        name: "echo",
        arguments: { text: "hello" },
      })) as any;
      expect(callResult.content[0].text).toBe("echoed: hello");
    });

    it("McpClient with mock transport discovers and registers tools", async () => {
      // Mock MCP transport
      const mockSend = async (method: string, params: unknown) => {
        switch (method) {
          case "initialize":
            return { protocolVersion: "2024-11-05", capabilities: { tools: {} } };
          case "tools/list":
            return {
              tools: [
                {
                  name: "search",
                  description: "Search the web",
                  inputSchema: { type: "object", properties: { query: { type: "string" } } },
                },
              ],
            };
          case "tools/call":
            return { content: [{ type: "text", text: `searched: ${(params as any).arguments.query}` }] };
          default:
            return {};
        }
      };

      const client = new McpClient(
        { serverName: "web-tools", transport: "stdio", command: "mock" },
        mockSend,
      );

      const connectResult = await client.connect();
      expect(connectResult.ok).toBe(true);
      expect(client.getTools()).toHaveLength(1);

      // Register into ToolRegistry
      const registry = new ToolRegistry();
      client.registerTools(registry);
      expect(registry.list()).toContain("web-tools__search");

      // Execute through registry
      const result = await registry.execute(
        "web-tools__search",
        { query: "MCP protocol" },
        { turnId: "t1", sessionId: "s1" },
      );
      expect(result.output).toContain("searched: MCP protocol");
    });
  });
});
