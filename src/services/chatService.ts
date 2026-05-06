import type { AppConfig } from '@/config';
import { RagCoreError } from '@/clients/ragCoreClient';
import type { PreparedChat, RagCoreClient } from '@/clients/ragCoreClient';
import type { LlmProvider } from '@/providers/llm';
import type { ChatRequest, ChatResponse } from '@/schemas/chat';
import type { Citation, Usage } from '@/schemas/common';

import { buildPrompt, extractLatestUserQuery } from '@/services/promptService';

export interface ChatServiceDeps {
  config: AppConfig;
  ragCore: RagCoreClient;
  llm: LlmProvider;
}

export interface ChatStreamHandlers {
  onToken: (token: string) => void | Promise<void>;
  onCitations: (citations: Citation[]) => void | Promise<void>;
  onUsage: (usage: Usage) => void | Promise<void>;
  onDone: () => void | Promise<void>;
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
    const prepared = await this.prepareLlmInput(req);
    const completion = await this.llm.complete({ messages: prepared.messages });

    return {
      answer: completion.content,
      citations: prepared.citations,
      usage: completion.usage,
    };
  }

  async stream(
    req: ChatRequest,
    handlers: ChatStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const prepared = await this.prepareLlmInput(req);
    await handlers.onCitations(prepared.citations);

    let usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };

    for await (const delta of this.llm.stream({ messages: prepared.messages, signal })) {
      if (delta.content) {
        await handlers.onToken(delta.content);
      }
      if (delta.usage) {
        usage = delta.usage;
      }
    }

    await handlers.onUsage(usage);
    await handlers.onDone();
  }

  private async prepareLlmInput(req: ChatRequest): Promise<PreparedChat> {
    try {
      return await this.ragCore.prepareChat({
        messages: req.messages,
        collectionId: req.collection_id,
        topK: this.config.ragCore.topK,
        maxContextChars: this.config.prompt.maxContextChars,
      });
    } catch (err) {
      if (!(err instanceof RagCoreError) || err.statusCode !== 404) {
        throw err;
      }
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

    return {
      messages,
      citations: usedCitations,
    };
  }
}
