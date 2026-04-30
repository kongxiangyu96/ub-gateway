import type { AppConfig } from '@/config';
import type { RagCoreClient } from '@/clients/ragCoreClient';
import type { LlmProvider } from '@/providers/llm';
import type { ChatRequest, ChatResponse } from '@/schemas/chat';

import { buildPrompt, extractLatestUserQuery } from '@/services/promptService';

export interface ChatServiceDeps {
  config: AppConfig;
  ragCore: RagCoreClient;
  llm: LlmProvider;
}

export class ChatService {
  private readonly config: AppConfig;
  private readonly ragCore: RagCoreClient;
  private readonly llm: LlmProvider;

  constructor(deps: ChatServiceDeps) {
    this.config = deps.config;
    this.ragCore = deps.ragCore;
    this.llm = deps.llm;
  }

  async handle(req: ChatRequest): Promise<ChatResponse> {
    if (req.stream) {
      // MVP 暂不支持流式，预留扩展点：未来可走 SSE / NDJSON
      throw new Error('streaming is not supported in MVP');
    }

    const query = extractLatestUserQuery(req.messages);

    const citations = await this.ragCore.retrieve({
      query,
      collectionId: req.collection_id,
      topK: this.config.ragCore.topK,
    });

    const { messages, usedCitations } = buildPrompt({
      history: req.messages,
      citations,
      maxContextChars: this.config.prompt.maxContextChars,
    });

    const completion = await this.llm.complete({ messages });

    return {
      answer: completion.content,
      citations: usedCitations,
      usage: completion.usage,
    };
  }
}
