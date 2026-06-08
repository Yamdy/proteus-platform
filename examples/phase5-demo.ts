/**
 * Phase 5 Demo: Knowledge Sharing + Governance + MCP
 *
 * Demonstrates:
 * 1. GlobalKnowledgeStore — cross-agent knowledge sharing
 * 2. KnowledgeAccessPolicy — access control
 * 3. GovernanceHooks H1-H4 — audit logging
 * 4. McpServer — expose tools via MCP protocol
 *
 * Run: npx tsx examples/phase5-demo.ts
 */

import {
  GlobalKnowledgeStore,
  CompositePolicy,
  OwnerOnlyWritePolicy,
  DenyTagPolicy,
  InMemoryAuditLog,
  registerGovernanceHooks,
  McpServer,
  ToolRegistry,
  HandlerEngine,
} from "../packages/core/src/index.js";

// --- 1. Knowledge Sharing ---

console.log("=== 1. Cross-Agent Knowledge Sharing ===\n");

const store = new GlobalKnowledgeStore();

// Agent A (security scanner) writes findings
const finding = store.put({
  key: "analysis/xss-vuln",
  value: { severity: "high", location: "comments.ts:42" },
  tags: ["security", "shared"],
  agentId: "security-scanner",
});
console.log("Agent A wrote:", finding.key, "→", finding.value);

// Agent B (code reviewer) reads shared knowledge
const shared = store.query({ tags: ["shared"] });
console.log("Agent B reads shared:", shared[0].value);
console.log();

// --- 2. Access Control ---

console.log("=== 2. Knowledge Access Policy ===\n");

const policy = new CompositePolicy([
  new OwnerOnlyWritePolicy(),
  new DenyTagPolicy(["restricted"]),
]);

// Owner can write
const ownerDecision = policy.check({
  agentId: "security-scanner",
  mode: "write",
  entry: finding,
});
console.log("Owner write:", ownerDecision);

// Non-owner cannot write
const otherDecision = policy.check({
  agentId: "code-reviewer",
  mode: "write",
  entry: finding,
});
console.log("Non-owner write:", otherDecision);
console.log();

// --- 3. Governance Audit ---

console.log("=== 3. Governance H1-H4 + Audit Log ===\n");

const auditLog = new InMemoryAuditLog();
const engine = new HandlerEngine();

registerGovernanceHooks(
  engine,
  {
    h2: async (ctx) => {
      // Block dangerous tools
      const toolName = ctx.turn.toolCalls?.[0]?.name;
      if (toolName === "delete_file") {
        return { suspend: true, pendingInput: "Approve deletion?" };
      }
      return null;
    },
  },
  auditLog,
);

console.log("Registered hooks:", engine.serialize().handlers.map((h) => h.name));
console.log("Audit log entries:", auditLog.size);
console.log();

// --- 4. MCP Server ---

console.log("=== 4. MCP Server ===\n");

const registry = new ToolRegistry();
registry.register({
  definition: {
    name: "analyze_code",
    description: "Analyze code for vulnerabilities",
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
  async execute(params) {
    return { output: `Analysis of ${(params as any).path}: no issues found` };
  },
});

const mcpServer = new McpServer(
  { name: "proteus", version: "0.1.0", capabilities: { tools: true } },
  registry,
);

// Simulate MCP client request
const toolsList = (await mcpServer.handleRequest("tools/list", {})) as any;
console.log("MCP tools exposed:", toolsList.tools.map((t: any) => t.name));

const callResult = (await mcpServer.handleRequest("tools/call", {
  name: "analyze_code",
  arguments: { path: "src/auth.ts" },
})) as any;
console.log("MCP tool result:", callResult.content[0].text);

console.log("\n✅ Phase 5 demo complete!");
