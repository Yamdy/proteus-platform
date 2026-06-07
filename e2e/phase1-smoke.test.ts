/**
 * Phase 1 E2E: 最小可运行 Agent
 *
 * User Story: 开发者用 3 行代码创建 Agent，发送消息，收到 LLM 回复
 * 所有断言都是用户可感知的行为，不依赖内部 API。
 *
 * 运行: npx vitest run e2e/phase1-smoke.test.ts
 */
import { describe, it, expect } from "vitest";
import { ProteusSDK } from "../packages/sdk/src/sdk.js";
import type { LLMProvider, LLMMessage, LLMResponse, ToolDefinition } from "../packages/core/src/types.js";

/** Mock LLM that echoes back the user's message with a prefix. */
function createMockLLM(): LLMProvider {
  return {
    async chat(messages: LLMMessage[], _tools: ToolDefinition[]): Promise<LLMResponse> {
      const lastUser = [...messages].reverse().find(m => m.role === "user");
      const content = lastUser ? `Echo: ${lastUser.content}` : "No input";
      return {
        content,
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop",
      };
    },
    async *chatStream(messages: LLMMessage[], _tools: ToolDefinition[]): AsyncIterable<LLMResponse> {
      const lastUser = [...messages].reverse().find(m => m.role === "user");
      const content = lastUser ? `Echo: ${lastUser.content}` : "No input";
      // Simulate streaming by yielding chunks
      const words = content.split(" ");
      for (const word of words) {
        yield {
          content: word + " ",
          usage: { promptTokens: 0, completionTokens: 0 },
          finishReason: "stop",
        };
      }
      yield {
        content: "",
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: "stop",
      };
    },
    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}

describe("Phase 1: 最小可运行 Agent", () => {
  it("发消息 → 收到回复", async () => {
    const sdk = new ProteusSDK({ llm: createMockLLM() });
    sdk.createSession("s1", {
      sessionId: "s1",
      llm: { provider: "mock", model: "mock-1", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    const result = await sdk.chat("s1", "1+1等于几？");
    expect(result.status).toBe("completed");
  });

  it("回复内容正确", async () => {
    const sdk = new ProteusSDK({ llm: createMockLLM() });
    sdk.createSession("s2", {
      sessionId: "s2",
      llm: { provider: "mock", model: "mock-1", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    await sdk.chat("s2", "1+1等于几？");
    const messages = sdk.getMessages("s2");
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    expect(lastAssistant?.content).toContain("Echo:");
    expect(lastAssistant?.content).toContain("1+1等于几？");
  });

  it("回复包含有效的 turnId", async () => {
    const sdk = new ProteusSDK({ llm: createMockLLM() });
    sdk.createSession("s3", {
      sessionId: "s3",
      llm: { provider: "mock", model: "mock-1", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    const result = await sdk.chat("s3", "你好");
    expect(result.turnId).toBeTruthy();
    expect(typeof result.turnId).toBe("string");
    expect(result.turnId.length).toBeGreaterThan(0);
  });

  it("CheckpointStore 中有 FrozenContext 快照", async () => {
    const sdk = new ProteusSDK({ llm: createMockLLM() });
    sdk.createSession("s4", {
      sessionId: "s4",
      llm: { provider: "mock", model: "mock-1", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    const result = await sdk.chat("s4", "测试");
    const checkpoint = sdk.store.loadLatestCheckpoint("s4");
    expect(checkpoint).toBeDefined();
    expect(checkpoint?.sessionId).toBe("s4");
    expect(checkpoint?.turnId).toBe(result.turnId);
  });

  it("CostTracker 记录了非零 token 用量", async () => {
    const sdk = new ProteusSDK({ llm: createMockLLM() });
    sdk.createSession("s5", {
      sessionId: "s5",
      llm: { provider: "mock", model: "mock-1", temperature: 0 },
      tools: {},
      logLevel: "info",
    });

    await sdk.chat("s5", "测试");
    const session = sdk.getSession("s5");
    const totals = session!.costTracker.getTotals();
    expect(totals.promptTokens).toBeGreaterThan(0);
    expect(totals.completionTokens).toBeGreaterThan(0);
  });
});
