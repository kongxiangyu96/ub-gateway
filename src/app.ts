import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from '@fastify/type-provider-zod';
import type { FastifyInstance } from 'fastify';

import { loadConfig } from '@/config';
import { RagCoreClient } from '@/clients/ragCoreClient';
import { createLlmProvider } from '@/providers/llm';
import { ChatService } from '@/services/chatService';
import { registerErrorHandler } from '@/plugins/errorHandler';
import { healthRoutes } from '@/routes/health';
import { chatRoutes } from '@/routes/chat';

export async function buildApp(): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.http.logLevel,
      transport:
        config.env === 'development'
          ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
          : undefined,
    },
    disableRequestLogging: false,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);

  const ragCore = new RagCoreClient({
    baseUrl: config.ragCore.baseUrl,
    timeoutMs: config.ragCore.timeoutMs,
  });
  const llm = createLlmProvider(config);
  const chatService = new ChatService({ config, ragCore, llm });

  registerErrorHandler(app);

  await app.register(healthRoutes);
  await app.register(chatRoutes, { chatService });

  // 预留扩展点：鉴权 / 多租户 / 流式
  if (config.features.authEnabled) {
    app.log.warn('AUTH_ENABLED=true 但鉴权插件尚未实现 (MVP)');
  }

  return app;
}
