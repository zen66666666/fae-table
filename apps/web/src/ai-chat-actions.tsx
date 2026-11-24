// 提供 AI 回答复制和追加到本机回复框的动作，供已完成的单轮回答复用。
import { useState } from 'react';
import type { ReactElement } from 'react';
import { AI_CHAT_COPY } from './ai-chat-copy.ts';
import { formatAiPlainAnswer } from './ai-chat-text.ts';
import { writeBrowserClipboard } from './browser-clipboard.ts';
import { Button } from './button.tsx';
import type { TicketReplyFillResult } from './ticket-reply-editor.tsx';

/** 允许复制和加入回复的内容及可替换的本机操作。 */
export type AiChatActionsProps = {
  answer: string;
  model?: string;
  onInsertReply: (text: string) => TicketReplyFillResult;
  writeClipboard?: (text: string) => Promise<void>;
};

type Feedback = TicketReplyFillResult | 'copied' | 'copy-failed';
const FEEDBACK_LABELS: Record<Feedback, string> = {
  inserted: AI_CHAT_COPY.appendDone,
  unavailable: AI_CHAT_COPY.appendUnavailable,
  'too-long': AI_CHAT_COPY.appendTooLong,
  copied: AI_CHAT_COPY.copyDone,
  'copy-failed': AI_CHAT_COPY.copyFailed,
};

/**
 * 复制或追加去掉展示标记和页码引用的纯文本，由回复框保存本机草稿。
 * @param props 已结束的回答和可替换的本机操作。
 * @returns 控件与固定反馈；没有可用的回答时为空。
 * @throws 无预期错误；剪贴板错误转换为固定提示。
 */
export function AiChatActions({
  answer,
  model,
  onInsertReply,
  writeClipboard = writeBrowserClipboard,
}: AiChatActionsProps): ReactElement | null {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const text = formatAiPlainAnswer(answer);
  if (!text && !model) return null;
  async function copyAnswer(): Promise<void> {
    try {
      await writeClipboard(text);
      setFeedback('copied');
    } catch {
      setFeedback('copy-failed');
    }
  }
  return (
    <div className="ai-chat-actions">
      {model && (
        <p className="ai-answer-model muted" title={model}>
          {model}
        </p>
      )}
      {text && (
        <>
          <Button
            size="small"
            className="ai-append-reply"
            onClick={() => setFeedback(onInsertReply(text))}
          >
            {AI_CHAT_COPY.append}
          </Button>
          <Button variant="quiet" size="small" onClick={() => void copyAnswer()}>
            {AI_CHAT_COPY.copy}
          </Button>
        </>
      )}
      {feedback && (
        <p className="muted" role="status">
          {FEEDBACK_LABELS[feedback]}
        </p>
      )}
    </div>
  );
}
