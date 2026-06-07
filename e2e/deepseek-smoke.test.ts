/**
 * DeepSeek API 连通性测试
 * 验证 createDeepSeekProvider 能正常调用 DeepSeek API
 */
import { describe, it, expect } from "vitest";
import { createDeepSeekProvider } from "../packages/core/src/llm/deepseek.js";
import type { LLMMessage, ToolDefinition } from "../packages/core/src/types.js";

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) throw new Error("DEEPSEEK_API_KEY environment variable is required");

describe("DeepSeek Provider", () => {
  it("基本对话：返回有效回复", async () => {
    const llm = createDeepSeekProvider({ apiKey: API_KEY });
    const messages: LLMMessage[] = [{ role: "user", content: "1+1等于几？只回答数字" }];
    const result = await llm.chat(messages, []);

    expect(result.content).toBeTruthy();
    expect(result.finishReason).toBe("stop");
    expect(result.usage.promptTokens).toBeGreaterThan(0);
    console.log("DeepSeek 回复:", result.content);
  }, 30000);

  it("工具调用：返回 tool_call", async () => {
    const llm = createDeepSeekProvider({ apiKey: API_KEY, temperature: 0 });
    const messages: LLMMessage[] = [{ role: "user", content: "帮我读取 /tmp/test.txt 文件" }];
    const tools: ToolDefinition[] = [{
      name: "read_file",
      description: "读取指定路径的文件内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
        },
        required: ["path"],
      },
    }];

    const result = await llm.chat(messages, tools);

    expect(result.finishReason).toBe("tool_call");
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls!.length).toBeGreaterThan(0);
    expect(result.toolCalls![0].name).toBe("read_file");
    console.log("工具调用:", JSON.stringify(result.toolCalls, null, 2));
  }, 30000);

  it("流式输出：返回有效内容", async () => {
    const llm = createDeepSeekProvider({ apiKey: API_KEY });
    const messages: LLMMessage[] = [{ role: "user", content: "用一句话介绍 TypeScript" }];
    let content = "";

    for await (const chunk of llm.chatStream(messages, [])) {
      if (chunk.content) content += chunk.content;
    }

    expect(content).toBeTruthy();
    console.log("流式输出:", content);
  }, 30000);
});
