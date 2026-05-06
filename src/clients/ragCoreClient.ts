import { request } from 'undici';
import { z } from 'zod';

import { CitationSchema } from '@/schemas/common';
import { ChatMessageSchema } from '@/schemas/chat';
import { IndexJobResponseSchema } from '@/schemas/knowledge';
import type { Citation } from '@/schemas/common';
import type { ChatMessage } from '@/schemas/chat';
import type { IndexJobResponse } from '@/schemas/knowledge';

export interface RagCoreClientOptions {
  baseUrl: string;
  timeoutMs: number;
  chatPreparePath: string;
  indexJobsPath: string;
}

export interface RetrieveParams {
  query: string;
  collectionId: string;
  topK: number;
}

export interface PrepareChatParams {
  messages: ChatMessage[];
  collectionId: string;
  topK: number;
  maxContextChars: number;
}

export interface PreparedChat {
  messages: ChatMessage[];
  citations: Citation[];
}

export interface CreateIndexJobParams {
  fileId: string;
  collectionId: string;
  bucket: string;
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

const RetrieveResponseSchema = z.object({
  chunks: z.array(CitationSchema),
});

const PreparedChatResponseSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1),
  citations: z.array(CitationSchema).default([]),
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
  private readonly chatPreparePath: string;
  private readonly indexJobsPath: string;

  constructor(opts: RagCoreClientOptions) {
    this.baseUrl = opts.baseUrl;
    this.timeoutMs = opts.timeoutMs;
    this.chatPreparePath = opts.chatPreparePath;
    this.indexJobsPath = opts.indexJobsPath;
  }

  async retrieve(params: RetrieveParams): Promise<Citation[]> {
    const parsed = await this.postJson({
      path: '/retrieve',
      operation: 'retrieve',
      body: {
        query: params.query,
        collection_id: params.collectionId,
        top_k: params.topK,
      },
      schema: RetrieveResponseSchema,
    });

    return parsed.chunks;
  }

  async prepareChat(params: PrepareChatParams): Promise<PreparedChat> {
    return this.postJson({
      path: this.chatPreparePath,
      operation: 'prepare chat',
      body: {
        messages: params.messages,
        collection_id: params.collectionId,
        top_k: params.topK,
        max_context_chars: params.maxContextChars,
      },
      schema: PreparedChatResponseSchema,
    });
  }

  async createIndexJob(params: CreateIndexJobParams): Promise<IndexJobResponse> {
    return this.postJson({
      path: this.indexJobsPath,
      operation: 'create index job',
      body: {
        file_id: params.fileId,
        collection_id: params.collectionId,
        bucket: params.bucket,
        object_key: params.objectKey,
        filename: params.filename,
        content_type: params.contentType,
        size_bytes: params.sizeBytes,
      },
      schema: IndexJobResponseSchema,
    });
  }

  async getIndexJob(jobId: string): Promise<IndexJobResponse> {
    return this.requestJson({
      path: `${this.indexJobsPath}/${encodeURIComponent(jobId)}`,
      method: 'GET',
      operation: 'get index job',
      schema: IndexJobResponseSchema,
    });
  }

  private async postJson<T>(params: {
    path: string;
    operation: string;
    body: unknown;
    schema: z.ZodType<T>;
  }): Promise<T> {
    return this.requestJson({
      path: params.path,
      method: 'POST',
      operation: params.operation,
      body: JSON.stringify(params.body),
      schema: params.schema,
    });
  }

  private async requestJson<T>(params: {
    path: string;
    method: 'GET' | 'POST';
    operation: string;
    body?: string;
    schema: z.ZodType<T>;
  }): Promise<T> {
    const url = `${this.baseUrl}${params.path}`;

    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(url, {
        method: params.method,
        headers: params.body ? { 'content-type': 'application/json' } : undefined,
        body: params.body,
        bodyTimeout: this.timeoutMs,
        headersTimeout: this.timeoutMs,
      });
    } catch (err) {
      throw new RagCoreError(
        `rag-core ${params.operation} network error: ${(err as Error).message}`,
        0,
        err,
      );
    }

    const text = await res.body.text();
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new RagCoreError(
        `rag-core ${params.operation} failed: ${res.statusCode}`,
        res.statusCode,
        text,
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new RagCoreError(
        `rag-core ${params.operation}: invalid JSON response`,
        res.statusCode,
        text,
      );
    }

    const parsed = params.schema.safeParse(json);
    if (!parsed.success) {
      throw new RagCoreError(
        `rag-core ${params.operation}: response shape mismatch`,
        res.statusCode,
        parsed.error.issues,
      );
    }
    return parsed.data;
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
