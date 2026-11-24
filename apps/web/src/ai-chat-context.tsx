// 展示本次 AI 输入的数量与页码概要，供右栏提问区使用。
import type { ReactElement } from 'react';
import type { AiChatSummary } from '../../../packages/core/src/index.ts';
import { AI_CHAT_COPY, formatAiChatTrimmed } from './ai-chat-copy.ts';

/** 后台实际发给 AI 的脱敏概要。 */
export type AiChatContextProps = { summary: AiChatSummary };

/**
 * 显示可折叠的资料概要，内容仅包括数量和 PDF 页码。
 * @param props 后台返回的数量概要。
 * @returns 提问区的详情控件。
 * @throws 无预期错误。
 */
export function AiChatContext({ summary }: AiChatContextProps): ReactElement {
  const pages = [...new Set(summary.manualPages)];
  const manual = `${AI_CHAT_COPY.manualChunks} ${summary.manualPages.length} ${AI_CHAT_COPY.manualChunkUnit}`;
  const pageText = pages.length ? AI_CHAT_COPY.formatPages(pages) : '';
  const trimmed = formatAiChatTrimmed(summary.trimmed);
  const counts = [
    `${AI_CHAT_COPY.fields} ${summary.fieldCount} ${AI_CHAT_COPY.fieldUnit}`,
    `${AI_CHAT_COPY.records} ${summary.recordCount} ${AI_CHAT_COPY.recordUnit}`,
    `${manual}${pageText}`,
    `${AI_CHAT_COPY.researchers} ${summary.researcherCount} ${AI_CHAT_COPY.researcherUnit}`,
  ];
  return (
    <details className="ai-chat-context">
      <summary>{AI_CHAT_COPY.context}</summary>
      <p className="muted">{counts.join('、')}</p>
      {trimmed && <p className="muted">{trimmed}</p>}
    </details>
  );
}
