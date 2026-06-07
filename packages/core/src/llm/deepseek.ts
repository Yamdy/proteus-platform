import type { LLMProvider } from "../types.js";
import { createProvider, type ProviderConfig } from "./provider.js";

export interface DeepSeekConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
}

/**
 * Create an LLM provider backed by DeepSeek's OpenAI-compatible API.
 *
 * @example
 * ```ts
 * const llm = createDeepSeekProvider({ apiKey: "sk-..." });
 * const result = await llm.chat(messages, tools);
 * ```
 */
export function createDeepSeekProvider(config: DeepSeekConfig): LLMProvider {
  return createProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl ?? "https://api.deepseek.com/v1",
    model: config.model ?? "deepseek-chat",
    temperature: config.temperature ?? 0,
  });
}
