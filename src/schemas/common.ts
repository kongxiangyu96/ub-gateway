import { z } from 'zod';

export const CitationMetadataSchema = z
  .object({
    title: z.string().nullable().optional(),
    page: z.number().int().nullable().optional(),
  })
  .catchall(z.unknown());

export const CitationSchema = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  text: z.string(),
  score: z.number(),
  metadata: CitationMetadataSchema.default({}),
});

export const UsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().default(0),
  completion_tokens: z.number().int().nonnegative().default(0),
});

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type Citation = z.infer<typeof CitationSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
