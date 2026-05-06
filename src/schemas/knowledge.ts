import { z } from 'zod';

export const IndexJobStatusSchema = z.enum(['queued', 'processing', 'completed', 'failed']);

export const IndexJobResponseSchema = z.object({
  job_id: z.string(),
  status: IndexJobStatusSchema,
  file_id: z.string().optional(),
  collection_id: z.string().optional(),
  object_key: z.string().optional(),
  message: z.string().optional(),
});

export const UploadKnowledgeFileResponseSchema = z.object({
  file_id: z.string(),
  object_key: z.string(),
  bucket: z.string(),
  index_job_id: z.string(),
  status: IndexJobStatusSchema,
});

export type IndexJobStatus = z.infer<typeof IndexJobStatusSchema>;
export type IndexJobResponse = z.infer<typeof IndexJobResponseSchema>;
export type UploadKnowledgeFileResponse = z.infer<typeof UploadKnowledgeFileResponseSchema>;
