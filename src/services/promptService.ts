import type { ChatMessage } from '@/schemas/chat';
import type { Citation } from '@/schemas/common';
import type { LlmMessage } from '@/providers/llm';

const DEFAULT_SYSTEM_PROMPT = [
  'You are UserBank Assistant, an answer engine that responds strictly based on the provided context.',
  'Rules:',
  '1. Use ONLY the information in <context> to answer; if it is insufficient, reply that you do not have enough information.',
  '2. Cite sources inline using the bracket form [#1], [#2] matching the order of context items.',
  '3. Keep answers concise, factual, and in the same language as the user question.',
].join('\n');

export interface BuildPromptParams {
  history: ChatMessage[];
  citations: Citation[];
  maxContextChars: number;
  systemPrompt?: string;
}

export interface BuiltPrompt {
  messages: LlmMessage[];
  /** 实际进入 prompt 的引用顺序（与 [#n] 对齐） */
  usedCitations: Citation[];
}

/**
 * 把检索得到的 citations 与对话历史组装为 LLM 可消费的 messages。
 * - context 区块控制总字符数，避免 prompt 爆炸
 * - usedCitations 顺序与 prompt 内 [#n] 引用顺序保持一致
 */
export function buildPrompt(params: BuildPromptParams): BuiltPrompt {
  const { history, citations, maxContextChars, systemPrompt } = params;

  const used: Citation[] = [];
  const blocks: string[] = [];
  let total = 0;

  for (const c of citations) {
    const header = `[#${used.length + 1}] (doc=${c.document_id}, chunk=${c.chunk_id}, score=${c.score.toFixed(
      3,
    )})`;
    const block = `${header}\n${c.text.trim()}`;
    if (total + block.length > maxContextChars && used.length > 0) {
      break;
    }
    blocks.push(block);
    used.push(c);
    total += block.length;
  }

  const contextBlock =
    blocks.length === 0
      ? '<context>\n(no relevant context retrieved)\n</context>'
      : `<context>\n${blocks.join('\n\n')}\n</context>`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    { role: 'system', content: contextBlock },
    ...history.map<LlmMessage>((m) => ({ role: m.role, content: m.content })),
  ];

  return { messages, usedCitations: used };
}

export function extractLatestUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return messages[messages.length - 1]?.content ?? '';
}
