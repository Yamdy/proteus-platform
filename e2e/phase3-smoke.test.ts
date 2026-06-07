/**
 * Phase 3 E2E: 服务化
 *
 * 验证：HTTP API + Session CRUD + Chat + Status + Metrics
 * 使用 mock LLM + 真实 Fastify server。
 *
 * 运行: npx vitest run e2e/phase3-smoke.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../packages/server/src/server.js";
import { createInMemoryStore } from "../packages/core/src/checkpoint-store.js";
import type { LLMProvider, LLMResponse, LLMMessage } from "../packages/core/src/types.js";

// --- Mock LLM ---

function createMockLLM(): LLMProvider {
  return {
    async chat(messages: LLMMessage[]): Promise<LLMResponse> {
      const last = messages[messages.length - 1];
      return {
        content: `Echo: ${last?.content ?? ""}`,
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop",
      };
    },
    async *chatStream(messages: LLMMessage[]): AsyncIterable<LLMResponse> {
      const last = messages[messages.length - 1];
      const text = `Echo: ${last?.content ?? ""}`;
      for (const char of text) {
        yield { content: char, usage: { promptTokens: 0, completionTokens: 0 }, finishReason: "stop" };
      }
      yield { content: "", usage: { promptTokens: 10, completionTokens: 5 }, finishReason: "stop" };
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}

// --- Test setup ---

const PORT = 13999;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  const store = createInMemoryStore();
  server = createServer({
    port: PORT, host: "127.0.0.1", cors: false,
    llm: createMockLLM(),
    store, sessionStore: store, costStore: store, eventLog: store,
  });
  await server.start();
});

afterAll(async () => {
  await server.stop();
});

// --- Tests ---

describe("Phase 3: Server E2E", () => {
  it("health check returns 200", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });

  it("create session", async () => {
    const res = await fetch(`${BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "test-s1", name: "Test Session" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("test-s1");
    expect(body.name).toBe("Test Session");
  });

  it("list sessions", async () => {
    const res = await fetch(`${BASE}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("test-s1");
  });

  it("get session by id", async () => {
    const res = await fetch(`${BASE}/api/sessions/test-s1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("test-s1");
  });

  it("chat returns echo response", async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "test-s1", message: "hello" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(body.response).toContain("Echo: hello");
  });

  it("messages endpoint returns history", async () => {
    const res = await fetch(`${BASE}/api/sessions/test-s1/messages`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(2);
  });

  it("status endpoint works", async () => {
    const res = await fetch(`${BASE}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lifecycle).toBeDefined();
    expect(body.uptime).toBeGreaterThan(0);
  });

  it("config endpoint works", async () => {
    const res = await fetch(`${BASE}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level0).toBeDefined();
    expect(body.level1).toBeDefined();
  });

  it("metrics endpoint works", async () => {
    const res = await fetch(`${BASE}/api/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalTraces).toBeDefined();
  });

  it("costs endpoint works", async () => {
    const res = await fetch(`${BASE}/api/costs`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalTokens).toBeDefined();
  });

  it("404 for unknown session", async () => {
    const res = await fetch(`${BASE}/api/sessions/nonexistent`);
    expect(res.status).toBe(404);
  });

  it("400 for missing body", async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("delete session", async () => {
    const res = await fetch(`${BASE}/api/sessions/test-s1`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const res2 = await fetch(`${BASE}/api/sessions`);
    const body = await res2.json();
    expect(body).toHaveLength(0);
  });
});
