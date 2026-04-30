import { OpenAiProvider } from '@/providers/llm/openaiProvider';
import type { LlmProvider } from '@/providers/llm/types';
import type { AppConfig } from '@/config';

export function createLlmProvider(config: AppConfig): LlmProvider {
  switch (config.llm.provider) {
    case 'openai':
      return new OpenAiProvider({
        baseUrl: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
        defaultTemperature: config.llm.temperature,
        defaultMaxTokens: config.llm.maxTokens,
      });
    default: {
      const exhaustive: never = config.llm.provider;
      throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
    }
  }
}

export type { LlmProvider, LlmMessage, LlmCompletionResult } from '@/providers/llm/types';
