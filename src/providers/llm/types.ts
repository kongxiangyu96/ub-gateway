import type { Usage } from '@/schemas/common';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionParams {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LlmCompletionResult {
  content: string;
  usage: Usage;
}

/**
 * LLM Provider 抽象。
 * MVP 仅实现 OpenAI 兼容协议；后续可扩展 anthropic / local / 流式等。
 */
export interface LlmProvider {
  readonly name: string;
  complete(params: LlmCompletionParams): Promise<LlmCompletionResult>;
}

export class LlmProviderError extends Error {
  readonly statusCode: number;
  readonly payload: unknown;

  constructor(message: string, statusCode: number, payload: unknown) {
    super(message);
    this.name = 'LlmProviderError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}
