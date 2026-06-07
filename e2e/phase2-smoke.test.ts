/**
 * Phase 2 E2E: 带工具的 Agent
 *
 * 验证：Agent 能调用工具（文件读写）+ 记忆读写
 * 使用 mock LLM 驱动工具调用链路，验证完整 pipeline。
 *
 * 运行: pnpm test (从 proteus-platform 根目录)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProteusSDK } from "../packages/sdk/src/sdk.js";
import { ReadFileTool, WriteFileTool, ListDirTool } from "../packages/core/src/tools/built-in.js";
import { RecallTool } from "../packages/core/src/memory/tools/recall-tool.js";
import { StoreMemoryTool } from "../packages/core/src/memory/tools/store-memory-tool.js";
import { InMemoryProvider } from "../packages/core/src/memory/in-memory-provider.js";
import { SemanticRecall } from "../packages/core/src/memory/semantic-recall.js";
import { InMemoryEmbeddingProvider } from "../packages/core/src/memory/in-memory-embedding-provider.js";
import type { LLMProvider, LLMResponse, ToolCall } from "../packages/core/src/types.js";
import type { EmbeddingFunction } from "../packages/core/src/memory/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// --- Helpers ---

const TEST_DIR = path.join(import.meta.dirname, "__tmp_e2e");

/** Deterministic synthetic embedding for testing. */
function syntheticEmbed(text: string): number[] {
  const DIM = 32;
  const vec = new Array<number>(DIM).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % DIM] += (text.charCodeAt(i) % 97) + 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/**
 * Create a mock LLM that returns scripted responses.
 * Each call pops the next response from the queue.
 */
function createMockLLM(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    async chat(_messages, _tools) {
      return responses[callIndex++] ?? responses[responses.length - 1];
    },
    async *chatStream(_messages, _tools) {
      yield responses[callIndex++] ?? responses[responses.length - 1];
    },
    countTokens(text: string) {
      return text.split(/\s+/).filter(Boolean).length;
    },
  };
}

function textResponse(content: string): LLMResponse {
  return {
    content,
    usage: { promptTokens: 10, completionTokens: 5 },
    finishReason: "stop",
  };
}

function toolCallResponse(toolCalls: ToolCall[]): LLMResponse {
  return {
    content: "",
    toolCalls,
    usage: { promptTokens: 10, completionTokens: 5 },
    finishReason: "tool_call",
  };
}

// --- Tests ---

function fullSessionConfig(sessionId: string) {
  return {
    sessionId,
    llm: { provider: "mock", model: "mock-1", temperature: 0 },
    tools: {},
    logLevel: "info" as const,
  };
}

describe("Phase 2: 带工具的 Agent", () => {
  let sdk: ProteusSDK;

  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("工具调用：文件读写", () => {
    it("Agent 调用 write_file → 文件被创建，内容正确", async () => {
      const testFile = path.join(TEST_DIR, "hello.txt");

      const llm = createMockLLM([
        toolCallResponse([{
          id: "tc1",
          name: "write_file",
          arguments: { path: testFile, content: "hello world" },
        }]),
        textResponse("我已创建 hello.txt，内容是 'hello world'。"),
      ]);

      sdk = new ProteusSDK({ llm });
      sdk.registerTool(new WriteFileTool());
      sdk.registerTool(new ReadFileTool());
      sdk.registerTool(new ListDirTool());
      sdk.createSession("s1", fullSessionConfig("s1"));

      const result = await sdk.chat("s1", "创建 hello.txt，内容 hello world");

      expect(result.status).toBe("completed");
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("hello world");
    });

    it("Agent 调用 read_file → 返回文件内容", async () => {
      const testFile = path.join(TEST_DIR, "read-test.txt");
      await fs.writeFile(testFile, "测试内容", "utf-8");

      const llm = createMockLLM([
        toolCallResponse([{
          id: "tc1",
          name: "read_file",
          arguments: { path: testFile },
        }]),
        textResponse("文件内容是：测试内容"),
      ]);

      sdk = new ProteusSDK({ llm });
      sdk.registerTool(new ReadFileTool());
      sdk.createSession("s1", fullSessionConfig("s1"));

      const result = await sdk.chat("s1", "读取 read-test.txt");

      expect(result.status).toBe("completed");
    });
  });

  describe("记忆读写", () => {
    it("Agent 调用 store_memory → 记忆被存储", async () => {
      const provider = new InMemoryProvider();
      provider.createThread({ threadId: "s1", sessionId: "s1", name: "test", createdAt: Date.now(), updatedAt: Date.now() });

      const llm = createMockLLM([
        toolCallResponse([{
          id: "tc1",
          name: "store_memory",
          arguments: { content: "用户喜欢 TypeScript" },
        }]),
        textResponse("已记住你喜欢 TypeScript。"),
      ]);

      sdk = new ProteusSDK({ llm });
      const embedProvider = new InMemoryEmbeddingProvider();
      const embedFn: EmbeddingFunction = async (text) => syntheticEmbed(text);
      const semanticRecall = new SemanticRecall({ provider: embedProvider, embedFn });

      sdk.registerTool(new StoreMemoryTool({ provider, handlerEngine: sdk.handlerEngine }));
      sdk.registerTool(new RecallTool({ semanticRecall, handlerEngine: sdk.handlerEngine }));
      sdk.createSession("s1", fullSessionConfig("s1"));

      const result = await sdk.chat("s1", "记住：我喜欢 TypeScript");

      expect(result.status).toBe("completed");
    });

    it("Agent 调用 recall → 检索到相关记忆", async () => {
      const provider = new InMemoryProvider();
      provider.createThread({ threadId: "s1", sessionId: "s1", name: "test", createdAt: Date.now(), updatedAt: Date.now() });

      const embedProvider = new InMemoryEmbeddingProvider();
      const embedFn: EmbeddingFunction = async (text) => syntheticEmbed(text);
      const semanticRecall = new SemanticRecall({ provider: embedProvider, embedFn });

      // Pre-store a memory entry
      await semanticRecall.store("s1", { role: "user", content: "我喜欢 TypeScript" });

      const llm = createMockLLM([
        toolCallResponse([{
          id: "tc1",
          name: "recall",
          arguments: { query: "喜欢什么语言" },
        }]),
        textResponse("你之前说过喜欢 TypeScript。"),
      ]);

      sdk = new ProteusSDK({ llm });
      sdk.registerTool(new RecallTool({ semanticRecall, handlerEngine: sdk.handlerEngine }));
      sdk.createSession("s1", fullSessionConfig("s1"));

      const result = await sdk.chat("s1", "我之前说过喜欢什么语言？");

      expect(result.status).toBe("completed");
    });
  });

  describe("多工具协作", () => {
    it("Agent 在一次 turn 中调用多个工具", async () => {
      const testFile = path.join(TEST_DIR, "multi.txt");

      const llm = createMockLLM([
        toolCallResponse([
          { id: "tc1", name: "write_file", arguments: { path: testFile, content: "multi tool test" } },
          { id: "tc2", name: "list_dir", arguments: { dirPath: TEST_DIR } },
        ]),
        textResponse("已创建文件并列出目录。"),
      ]);

      sdk = new ProteusSDK({ llm });
      sdk.registerTool(new WriteFileTool());
      sdk.registerTool(new ListDirTool());
      sdk.createSession("s1", fullSessionConfig("s1"));

      const result = await sdk.chat("s1", "创建 multi.txt 并列出目录");

      expect(result.status).toBe("completed");
      const content = await fs.readFile(testFile, "utf-8");
      expect(content).toBe("multi tool test");
    });
  });
});
