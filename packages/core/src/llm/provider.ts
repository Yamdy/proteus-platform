import type { LLMProvider } from "../types.js";
import { createProtocol, type OpenAIChatConfig } from "./protocols/openai-chat.js";

export interface ProviderConfig {
  baseUrl?: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  thinking?: boolean;
  reasoningEffort?: string;
}

export function createProvider(config: ProviderConfig): LLMProvider {
  const protocolConfig: OpenAIChatConfig = {
    baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
    apiKey: config.apiKey ?? "",
    model: config.model,
    temperature: config.temperature ?? 0,
    thinking: config.thinking,
    reasoningEffort: config.reasoningEffort,
  };

  const protocol = createProtocol(protocolConfig);

  return {
    chat: (messages, tools) => protocol.chat(messages, tools),
    chatStream: (messages, tools) => protocol.chatStream(messages, tools),
    countTokens: (text) => protocol.countTokens(text),
  };
}
