import { request } from 'undici';
import { z } from 'zod';

import { LlmProviderError } from '@/providers/llm/types';
import type {
  LlmCompletionParams,
  LlmCompletionResult,
  LlmProvider,
  LlmStreamDelta,
} from '@/providers/llm/types';

export interface OpenAiProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

const OpenAiResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          role: z.string(),
          content: z.string().nullable().default(''),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const OpenAiStreamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().optional(),
          })
          .passthrough()
          .default({}),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .default([]),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * OpenAI 兼容 Chat Completions Provider。
 * 兼容 OpenAI / Azure OpenAI / vLLM / LlamaEdge 等遵循 /chat/completions 协议的服务。
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;

  constructor(opts: OpenAiProviderOptions) {
    this.baseUrl = opts.baseUrl;
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs;
    this.defaultTemperature = opts.defaultTemperature;
    this.defaultMaxTokens = opts.defaultMaxTokens;
  }

  async complete(params: LlmCompletionParams): Promise<LlmCompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.model,
      messages: params.messages,
      temperature: params.temperature ?? this.defaultTemperature,
      max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      stream: false,
    });

    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
        signal: params.signal,
      });
    } catch (err) {
      throw new LlmProviderError(
        `openai chat completions network error: ${(err as Error).message}`,
        0,
        err,
      );
    }

    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new LlmProviderError(
        `openai chat completions failed: ${res.statusCode}`,
        res.statusCode,
        text,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmProviderError('openai chat completions: invalid JSON', res.statusCode, text);
    }

    const parsed = OpenAiResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new LlmProviderError(
        'openai chat completions: response shape mismatch',
        res.statusCode,
        parsed.error.issues,
      );
    }

    const choice = parsed.data.choices[0];
    return {
      content: choice.message.content ?? '',
      usage: {
        prompt_tokens: parsed.data.usage?.prompt_tokens ?? 0,
        completion_tokens: parsed.data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async *stream(params: LlmCompletionParams): AsyncIterable<LlmStreamDelta> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: this.model,
      messages: params.messages,
      temperature: params.temperature ?? this.defaultTemperature,
      max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      stream: true,
      stream_options: { include_usage: true },
    });

    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body,
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
        signal: params.signal,
      });
    } catch (err) {
      throw new LlmProviderError(
        `openai chat completions stream network error: ${(err as Error).message}`,
        0,
        err,
      );
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const text = await res.body.text();
      throw new LlmProviderError(
        `openai chat completions stream failed: ${res.statusCode}`,
        res.statusCode,
        text,
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of res.body) {
      buffer += decoder.decode(toUint8Array(chunk), { stream: true }).replace(/\r\n/g, '\n');
      let delimiterIndex = buffer.indexOf('\n\n');

      while (delimiterIndex !== -1) {
        const frame = buffer.slice(0, delimiterIndex);
        buffer = buffer.slice(delimiterIndex + 2);

        const delta = parseStreamFrame(frame, res.statusCode);
        if (delta === 'done') return;
        if (delta) yield delta;

        delimiterIndex = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim().length > 0) {
      const delta = parseStreamFrame(buffer, res.statusCode);
      if (delta && delta !== 'done') yield delta;
    }
  }
}

function parseStreamFrame(frame: string, statusCode: number): LlmStreamDelta | 'done' | null {
  const dataLines = frame
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart());

  if (dataLines.length === 0) return null;

  const data = dataLines.join('\n');
  if (data === '[DONE]') return 'done';

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new LlmProviderError('openai chat completions stream: invalid JSON', statusCode, data);
  }

  const parsed = OpenAiStreamChunkSchema.safeParse(json);
  if (!parsed.success) {
    throw new LlmProviderError(
      'openai chat completions stream: response shape mismatch',
      statusCode,
      parsed.error.issues,
    );
  }

  const choice = parsed.data.choices[0];
  return {
    content: choice?.delta.content,
    finishReason: choice?.finish_reason,
    usage: parsed.data.usage
      ? {
          prompt_tokens: parsed.data.usage.prompt_tokens ?? 0,
          completion_tokens: parsed.data.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (typeof chunk === 'string') return Buffer.from(chunk);
  return Buffer.from(String(chunk));
}
