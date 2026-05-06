import type { FastifyError, FastifyInstance } from 'fastify';

import { RagCoreError } from '@/clients/ragCoreClient';
import { StorageError } from '@/clients/minioClient';
import { LlmProviderError } from '@/providers/llm/types';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((rawError, request, reply) => {
    const error = rawError as FastifyError & { validation?: unknown };
    const log = request.log;

    if (error.validation) {
      log.warn({ err: error }, 'request validation failed');
      return reply.status(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: error.message,
          details: error.validation,
        },
      });
    }

    if (error instanceof RagCoreError) {
      log.error({ err: error, payload: error.payload }, 'rag-core upstream error');
      return reply.status(502).send({
        error: {
          code: 'RAG_CORE_UPSTREAM_ERROR',
          message: error.message,
        },
      });
    }

    if (error instanceof LlmProviderError) {
      log.error({ err: error, payload: error.payload }, 'llm upstream error');
      return reply.status(502).send({
        error: {
          code: 'LLM_UPSTREAM_ERROR',
          message: error.message,
        },
      });
    }

    if (error instanceof StorageError) {
      log.error({ err: error, payload: error.payload }, 'object storage error');
      return reply.status(502).send({
        error: {
          code: 'OBJECT_STORAGE_ERROR',
          message: error.message,
        },
      });
    }

    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;

    log.error({ err: error }, 'unhandled error');
    return reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: statusCode >= 500 ? 'Internal Server Error' : error.message,
      },
    });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });
}
