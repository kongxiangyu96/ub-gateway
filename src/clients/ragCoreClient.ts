import { request } from 'undici';
import { z } from 'zod';

import { CitationSchema } from '@/schemas/common';
import type { Citation } from '@/schemas/common';

export interface RagCoreClientOptions {
  baseUrl: string;
  timeoutMs: number;
}

export interface RetrieveParams {
  query: string;
  collectionId: string;
  topK: number;
}

const RetrieveResponseSchema = z.object({
  chunks: z.array(CitationSchema),
});

export type RetrieveResponse = z.infer<typeof RetrieveResponseSchema>;

/**
 * userbank-rag-core 检索客户端。
 *
 * 默认协议契约（可在下游服务变化时统一在这里调整）：
 *   POST {baseUrl}/retrieve
 *   body: { query, collection_id, top_k }
 *   200:  { chunks: Citation[] }
 */
export class RagCoreClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: RagCoreClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs;
  }

  async retrieve(params: RetrieveParams): Promise<Citation[]> {
    const url = `${this.baseUrl}/retrieve`;
    const body = JSON.stringify({
      query: params.query,
      collection_id: params.collectionId,
      top_k: params.topK,
    });

    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
      });
    } catch (err) {
      throw new RagCoreError(
        `rag-core retrieve network error: ${(err as Error).message}`,
        0,
        err,
      );
    }

    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new RagCoreError(
        `rag-core retrieve failed: ${res.statusCode}`,
        res.statusCode,
        text,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new RagCoreError('rag-core retrieve: invalid JSON response', res.statusCode, text);
    }

    const parsed = RetrieveResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new RagCoreError(
        'rag-core retrieve: response shape mismatch',
        res.statusCode,
        parsed.error.issues,
      );
    }
    return parsed.data.chunks;
  }
}

export class RagCoreError extends Error {
  readonly statusCode: number;
  readonly payload: unknown;

  constructor(message: string, statusCode: number, payload: unknown) {
    super(message);
    this.name = 'RagCoreError';
    this.statusCode = statusCode;
    this.payload = payload;
  }
}
