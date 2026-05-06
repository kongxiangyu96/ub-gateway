import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';

import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import { ErrorResponseSchema } from '@/schemas/common';
import { IndexJobResponseSchema, UploadKnowledgeFileResponseSchema } from '@/schemas/knowledge';
import type { RagCoreClient } from '@/clients/ragCoreClient';
import type { MinioStorageClient } from '@/clients/minioClient';
import type { AppConfig } from '@/config';

export interface KnowledgeRoutesDeps {
  config: AppConfig;
  ragCore: RagCoreClient;
  storage: MinioStorageClient;
}

export async function knowledgeRoutes(
  app: FastifyInstance,
  deps: KnowledgeRoutesDeps,
): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/knowledge/files',
    {
      schema: {
        response: {
          200: UploadKnowledgeFileResponseSchema,
          400: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      if (!request.isMultipart()) {
        throw app.httpErrors.badRequest('multipart/form-data required');
      }

      const saved = await request.saveRequestFiles({
        limits: {
          files: 1,
          fields: 5,
          fileSize: deps.config.upload.maxFileSizeBytes,
        },
      });

      try {
        const file = saved.files[0];
        if (!file) {
          throw app.httpErrors.badRequest('file field is required');
        }

        const collectionId = readTextField(saved.values, 'collection_id') ?? 'default';
        const fileId = randomUUID();
        const objectKey = deps.storage.buildKnowledgeObjectKey(
          collectionId,
          fileId,
          file.filename,
        );
        const stats = await stat(file.filepath);

        const uploaded = await deps.storage.uploadFile({
          filePath: file.filepath,
          objectKey,
          contentType: file.mimetype,
        });

        const job = await deps.ragCore.createIndexJob({
          fileId,
          collectionId,
          bucket: uploaded.bucket,
          objectKey: uploaded.objectKey,
          filename: file.filename,
          contentType: file.mimetype,
          sizeBytes: stats.size,
        });

        return {
          file_id: fileId,
          object_key: uploaded.objectKey,
          bucket: uploaded.bucket,
          index_job_id: job.job_id,
          status: job.status,
        };
      } finally {
        await request.cleanRequestFiles();
      }
    },
  );

  app.withTypeProvider<ZodTypeProvider>().get(
    '/knowledge/index-jobs/:job_id',
    {
      schema: {
        params: IndexJobParamsSchema,
        response: {
          200: IndexJobResponseSchema,
          400: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      return deps.ragCore.getIndexJob(request.params.job_id);
    },
  );
}

const IndexJobParamsSchema = z.object({
  job_id: z.string().min(1),
});

function readTextField(values: Record<string, unknown>, name: string): string | undefined {
  const entry = values[name];
  const value = Array.isArray(entry) ? entry[0] : entry;

  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || !('value' in value)) return undefined;

  const fieldValue = (value as { value: unknown }).value;
  return typeof fieldValue === 'string' && fieldValue.trim().length > 0
    ? fieldValue.trim()
    : undefined;
}
