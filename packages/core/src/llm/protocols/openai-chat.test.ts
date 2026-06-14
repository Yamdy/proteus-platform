import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProtocol } from "./openai-chat.js";
import type { LLMMessage, ToolDefinition } from "../../types.js";

// Helper to build a ReadableStream from SSE lines
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

function makeConfig() {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "test-model",
  };
}

const messages: LLMMessage[] = [{ role: "user", content: "Hello" }];
const noTools: ToolDefinition[] = [];

describe("openai-chat protocol", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Non-streaming ---

  describe("chat (non-streaming)", () => {
    it("returns content without reasoning when absent", async () => {
      const mockResponse = {
        choices: [
          {
            message: { role: "assistant", content: "Hi there" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const protocol = createProtocol(makeConfig());
      const result = await protocol.chat(messages, noTools);

      expect(result.content).toBe("Hi there");
      expect(result.thinking).toBeUndefined();
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
    });

    it("extracts reasoning_content from response", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: "The answer is 42",
              reasoning_content: "Let me think step by step...",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 30 },
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const protocol = createProtocol(makeConfig());
      const result = await protocol.chat(messages, noTools);

      expect(result.content).toBe("The answer is 42");
      expect(result.thinking).toBe("Let me think step by step...");
    });

    it("extracts thinking (Claude style) from response", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: "Sure!",
              thinking: "Claude-style thinking block",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const protocol = createProtocol(makeConfig());
      const result = await protocol.chat(messages, noTools);

      expect(result.thinking).toBe("Claude-style thinking block");
    });

    it("prefers reasoning_content over thinking when both present", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              role: "assistant",
              content: "OK",
              reasoning_content: "OpenAI reasoning",
              thinking: "Claude thinking",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      };

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      }));

      const protocol = createProtocol(makeConfig());
      const result = await protocol.chat(messages, noTools);

      expect(result.thinking).toBe("OpenAI reasoning");
    });
  });

  // --- Streaming ---

  describe("chatStream (streaming)", () => {
    async function collectStream(lines: string[]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        body: sseStream(lines),
      }));

      const protocol = createProtocol(makeConfig());
      const chunks = [];
      for await (const chunk of protocol.chatStream(messages, noTools)) {
        chunks.push(chunk);
      }
      return chunks;
    }

    it("yields content chunks", async () => {
      const lines = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        'data: {"choices":[{"finish_reason":"stop"}]}',
        "data: [DONE]",
      ];

      const chunks = await collectStream(lines);
      const contentChunks = chunks.filter((c) => c.content !== "");
      expect(contentChunks).toHaveLength(2);
      expect(contentChunks[0].content).toBe("Hello");
      expect(contentChunks[1].content).toBe(" world");
    });

    it("yields reasoning_content as thinking chunks", async () => {
      const lines = [
        'data: {"choices":[{"delta":{"reasoning_content":"Let me "}}]}',
        'data: {"choices":[{"delta":{"reasoning_content":"think..."}}]}',
        'data: {"choices":[{"delta":{"content":"The answer is 42"}}]}',
        'data: {"choices":[{"finish_reason":"stop"}]}',
        "data: [DONE]",
      ];

      const chunks = await collectStream(lines);

      const thinkingChunks = chunks.filter((c) => c.thinking);
      expect(thinkingChunks).toHaveLength(2);
      expect(thinkingChunks[0].thinking).toBe("Let me ");
      expect(thinkingChunks[1].thinking).toBe("think...");

      const contentChunks = chunks.filter((c) => c.content !== "");
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0].content).toBe("The answer is 42");

      // thinking must NOT leak into content
      for (const c of contentChunks) {
        expect(c.thinking).toBeUndefined();
      }
    });

    it("yields thinking (Claude style) chunks", async () => {
      const lines = [
        'data: {"choices":[{"delta":{"thinking":"Claude "}}]}',
        'data: {"choices":[{"delta":{"thinking":"reasoning"}}]}',
        'data: {"choices":[{"delta":{"content":"Response"}}]}',
        'data: {"choices":[{"finish_reason":"stop"}]}',
        "data: [DONE]",
      ];

      const chunks = await collectStream(lines);

      const thinkingChunks = chunks.filter((c) => c.thinking);
      expect(thinkingChunks).toHaveLength(2);
      expect(thinkingChunks[0].thinking).toBe("Claude ");
      expect(thinkingChunks[1].thinking).toBe("reasoning");
    });

    it("has no thinking when absent from stream", async () => {
      const lines = [
        'data: {"choices":[{"delta":{"content":"Just content"}}]}',
        'data: {"choices":[{"finish_reason":"stop"}]}',
        "data: [DONE]",
      ];

      const chunks = await collectStream(lines);
      for (const chunk of chunks) {
        expect(chunk.thinking).toBeUndefined();
      }
    });

    it("handles tool_calls in stream", async () => {
      const lines = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search","arguments":""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"q\\":\\""}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"test\\"}"}}]}}]}',
        'data: {"choices":[{"finish_reason":"tool_calls"}]}',
        "data: [DONE]",
      ];

      const chunks = await collectStream(lines);
      const toolChunks = chunks.filter((c) => c.toolCalls && c.toolCalls.length > 0);
      expect(toolChunks).toHaveLength(1);
      expect(toolChunks[0].toolCalls![0].name).toBe("search");
      expect(toolChunks[0].toolCalls![0].arguments).toEqual({ q: "test" });
      expect(toolChunks[0].finishReason).toBe("tool_call");
    });

    it("skips malformed JSON lines", async () => {
      const lines = [
        "data: {not valid json",
        'data: {"choices":[{"delta":{"content":"OK"}}]}',
        "data: [DONE]",
      ];

      const chunks = await collectStream(lines);
      const contentChunks = chunks.filter((c) => c.content !== "");
      expect(contentChunks).toHaveLength(1);
      expect(contentChunks[0].content).toBe("OK");
    });
  });
});
