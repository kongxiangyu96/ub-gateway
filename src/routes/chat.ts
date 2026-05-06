import { createSession } from 'better-sse';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from '@fastify/type-provider-zod';

import { ChatRequestSchema, ChatResponseSchema } from '@/schemas/chat';
import { ErrorResponseSchema } from '@/schemas/common';
import type { ChatService } from '@/services/chatService';

export interface ChatRoutesDeps {
  chatService: ChatService;
}

export async function chatRoutes(app: FastifyInstance, deps: ChatRoutesDeps): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/chat',
    {
      schema: {
        body: ChatRequestSchema,
        response: {
          200: ChatResponseSchema,
          400: ErrorResponseSchema,
          502: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (request.body.stream) {
        reply.hijack();

        const abortController = new AbortController();
        reply.raw.on('close', () => abortController.abort());

        const session = await createSession(request.raw, reply.raw, {
          keepAlive: 10000,
          serializer: JSON.stringify,
        });

        try {
          await deps.chatService.stream(
            request.body,
            {
              onCitations: (citations) => {
                session.push({ citations }, 'citations');
              },
              onToken: (content) => {
                session.push({ content }, 'token');
              },
              onUsage: (usage) => {
                session.push({ usage }, 'usage');
              },
              onDone: () => {
                session.push({ ok: true }, 'done');
              },
            },
            abortController.signal,
          );
        } catch (err) {
          request.log.error({ err }, 'chat stream failed');
          if (session.isConnected) {
            session.push({ message: (err as Error).message }, 'error');
          }
        } finally {
          if (!reply.raw.writableEnded) {
            reply.raw.end();
          }
        }
        return;
      }

      const result = await deps.chatService.handle(request.body);
      return result;
    },
  );
}
