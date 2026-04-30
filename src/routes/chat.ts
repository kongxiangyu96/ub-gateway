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
    async (request) => {
      const result = await deps.chatService.handle(request.body);
      return result;
    },
  );
}
