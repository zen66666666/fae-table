// 展示单轮提问、逐步生成的回答及结束提示，供助手消息区使用。
import type { ReactElement } from 'react';
import { AiAnswerText } from './ai-answer-text.tsx';
import { AiChatActions } from './ai-chat-actions.tsx';
import type { AiChatActionsProps } from './ai-chat-actions.tsx';
import { AI_CHAT_COPY, AI_CHAT_OUTCOME_LABELS, formatAiChatTrimmed } from './ai-chat-copy.ts';
import { AiChatWaiting } from './ai-chat-waiting.tsx';
import { Button } from './button.tsx';
import type { PollingClock } from './polling-clock.ts';
import type { AiChatDisplayTurn } from './use-ticket-ai-chat.ts';

/** 单据范围、当前问答和本机回复操作。 */
export type AiChatTurnProps = Omit<AiChatActionsProps, 'answer' | 'model'> & {
  ticketId: string;
  turn: AiChatDisplayTurn;
  clock?: PollingClock;
  now?: () => number;
  onRetry?: () => void;
};

/**
 * 渲染用户问题和纯文本回答，并明确未使用手册的回答。
 * @param props 当前问答、单据和可替换的本机操作。
 * @returns 右栏的一轮消息。
 * @throws 无预期错误。
 */
export function AiChatTurn({
  ticketId,
  turn,
  clock,
  now,
  onRetry,
  ...actions
}: AiChatTurnProps): ReactElement {
  const { question, answer, summary, outcome, startedAt, thinkingStartedAt, model } = turn;
  const feedbackStartedAt = thinkingStartedAt ?? startedAt;
  const isThinking = thinkingStartedAt !== undefined;
  const hasAnswer = Boolean(answer.trim());
  const hasManual = Boolean(summary?.manualPages.length);
  const trimmed = formatAiChatTrimmed(summary?.trimmed);
  const manualNote = summary?.isManualWithoutText
    ? `${AI_CHAT_COPY.noManual} · ${AI_CHAT_COPY.noManualText}`
    : AI_CHAT_COPY.noManual;
  const message = outcome === null ? '' : AI_CHAT_OUTCOME_LABELS[outcome];
  return (
    <article className="ai-chat-turn">
      <p className="ai-chat-question" aria-label={AI_CHAT_COPY.question}>
        {question}
      </p>
      <div className="ai-chat-answer" aria-label={AI_CHAT_COPY.answer}>
        {trimmed && <p className="muted">{trimmed}</p>}
        {outcome === null && !hasAnswer && feedbackStartedAt !== undefined && (
          <AiChatWaiting
            key={feedbackStartedAt}
            startedAt={feedbackStartedAt}
            isThinking={isThinking}
            clock={clock}
            now={now}
          />
        )}
        {hasAnswer && (
          <>
            {!hasManual && <p className="ai-manual-note muted">{manualNote}</p>}
            <AiAnswerText
              ticketId={ticketId}
              answer={answer}
              manualPageCount={hasManual ? (summary?.manualPageCount ?? 0) : 0}
            />
          </>
        )}
        {message && (
          <p className="muted" role="status">
            {message}
          </p>
        )}
        {outcome === 'timeout' && (
          <div className="ai-chat-actions">
            <Button variant="quiet" size="small" disabled={!onRetry} onClick={onRetry}>
              {AI_CHAT_COPY.askAgain}
            </Button>
          </div>
        )}
      </div>
      {hasAnswer &&
        (outcome ? (
          <AiChatActions answer={answer} model={model} {...actions} />
        ) : (
          model && (
            <p className="ai-answer-model muted" title={model}>
              {model}
            </p>
          )
        ))}
    </article>
  );
}
