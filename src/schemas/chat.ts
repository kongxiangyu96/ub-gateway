import { z } from 'zod';

import { CitationSchema, UsageSchema } from '@/schemas/common';

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1, 'messages 不能为空'),
  collection_id: z.string().min(1).default('default'),
  stream: z.boolean().default(false),
});

export const ChatResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
  usage: UsageSchema,
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
