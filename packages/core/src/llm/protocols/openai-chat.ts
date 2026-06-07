import type {
  LLMMessage,
  LLMResponse,
  ToolDefinition,
  ToolCall,
} from "../../types.js";
import { LLMResponseSchema } from "../../schemas/llm.js";

// --- Wire types (OpenAI Chat Completions format) ---

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// --- Mapping functions ---

function mapMessages(messages: LLMMessage[]): OpenAIMessage[] {
  return messages.map((m) => {
    if (m.role === "system") return { role: "system", content: m.content };
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") return { role: "assistant", content: m.content };
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
  });
}

function mapTools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function mapToolCalls(toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>): ToolCall[] {
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls.map((tc) => ({
    id: tc.id ?? "",
    name: tc.function?.name ?? "",
    arguments: JSON.parse(tc.function?.arguments ?? "{}"),
  }));
}

function mapFinishReason(reason: string): LLMResponse["finishReason"] {
  switch (reason) {
    case "stop": return "stop";
    case "tool_calls": return "tool_call";
    case "length": return "length";
    default: return "error";
  }
}

// --- Protocol ---

export interface OpenAIChatConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  thinking?: boolean;
  reasoningEffort?: string;
}

export interface OpenAIChatProtocol {
  chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;
  chatStream(messages: LLMMessage[], tools: ToolDefinition[]): AsyncIterable<LLMResponse>;
  countTokens(text: string): number;
}

export function createProtocol(config: OpenAIChatConfig): OpenAIChatProtocol {
  const { baseUrl, apiKey, model, temperature = 0, thinking, reasoningEffort } = config;

  function buildBody(messages: LLMMessage[], tools: ToolDefinition[], stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: mapMessages(messages),
      temperature,
    };
    if (stream) body.stream = true;
    if (tools.length > 0) body.tools = mapTools(tools);
    if (thinking) body.thinking = { type: "enabled" };
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    return body;
  }

  function buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
  }

  async function chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(buildBody(messages, tools, false)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const choice = data.choices[0];
    const message = choice?.message;

    const result: LLMResponse = {
      content: message?.content ?? "",
      thinking: message?.reasoning_content ?? undefined,
      toolCalls: mapToolCalls(message?.tool_calls ?? []),
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
      },
      finishReason: mapFinishReason(choice?.finish_reason ?? "stop"),
    };

    const parsed = LLMResponseSchema.safeParse(result);
    if (!parsed.success) {
      throw new Error(`LLMResponse validation failed: ${JSON.stringify(parsed.error.issues)}`);
    }

    return result;
  }

  async function *chatStream(messages: LLMMessage[], tools: ToolDefinition[]): AsyncIterable<LLMResponse> {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(buildBody(messages, tools, true)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls: ToolCall[] = [];
    let finishReason: LLMResponse["finishReason"] = "stop";
    let usage = { promptTokens: 0, completionTokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;

          if (delta?.reasoning_content) {
            yield { content: "", thinking: delta.reasoning_content, usage: { promptTokens: 0, completionTokens: 0 }, finishReason: "stop" };
          }
          if (delta?.content) {
            yield { content: delta.content, usage: { promptTokens: 0, completionTokens: 0 }, finishReason: "stop" };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.index !== undefined) {
                if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: "", name: "", arguments: {} };
                if (tc.id) toolCalls[tc.index].id = tc.id;
                if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                if (tc.function?.arguments) {
                  try { toolCalls[tc.index].arguments = JSON.parse(tc.function.arguments); } catch { /* partial */ }
                }
              }
            }
          }
          if (chunk.choices?.[0]?.finish_reason) finishReason = mapFinishReason(chunk.choices[0].finish_reason);
          if (chunk.usage) {
            usage = { promptTokens: chunk.usage.prompt_tokens ?? 0, completionTokens: chunk.usage.completion_tokens ?? 0 };
          }
        } catch { /* skip malformed */ }
      }
    }

    if (toolCalls.length > 0) yield { content: "", toolCalls, usage, finishReason };
    yield { content: "", usage, finishReason };
  }

  function countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  return { chat, chatStream, countTokens };
}
