// 展示右栏的单据 AI 对话、独立消息滚动区和固定提问框。
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { AiChatComposer } from './ai-chat-composer.tsx';
import { AI_CHAT_COPY } from './ai-chat-copy.ts';
import { AiChatHeading } from './ai-chat-heading.tsx';
import type { AiChatHeadingProps } from './ai-chat-heading.tsx';
import { AiChatModelControls } from './ai-chat-model-controls.tsx';
import { AiChatTurn } from './ai-chat-turn.tsx';
import { AiQuickQuestions } from './ai-quick-questions.tsx';
import type { WorkbenchClient } from './api-client.ts';
import { Button } from './button.tsx';
import type { PollingClock } from './polling-clock.ts';
import { TICKET_COPY } from './ticket-copy.ts';
import type { TicketReplyFillResult } from './ticket-reply-editor.tsx';
import type { AiModelControls } from './use-ai-model-controls.ts';
import { useTicketAiChat } from './use-ticket-ai-chat.ts';
import type { TicketAiChatOptions } from './use-ticket-ai-chat.ts';
import './ai-conversation.css';

const FOLLOW_SCROLL_DISTANCE_PX = 24;

/** 当前单据的接口、布局控制以及可替换的草稿和剪贴板动作。 */
export type AiConversationProps = {
  id: string | null;
  client: WorkbenchClient;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  modelControls?: AiModelControls;
  onModelSettings?: () => void;
  isKnownActive?: boolean;
  onActivityChange?: () => void;
  createController?: TicketAiChatOptions['createController'];
  now?: () => number;
  clock?: PollingClock;
  confirmClear?: AiChatHeadingProps['confirmClear'];
  writeClipboard?: (text: string) => Promise<void>;
  onInsertReply: (text: string) => TicketReplyFillResult;
};

function canFollowHistory(element: HTMLDivElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SCROLL_DISTANCE_PX
  );
}

/**
 * 按当前单据恢复历史、展示流式回答并保留独立的提问框。
 * @param props 当前单据、同源客户端和可替换的本机动作。
 * @returns 右栏中独立滚动的 AI 助手。
 * @throws 无预期错误；读取和生成错误均转为固定提示。
 */
export function AiConversation({
  id,
  client,
  isExpanded,
  onToggleExpanded,
  modelControls,
  onModelSettings,
  isKnownActive,
  onActivityChange,
  createController,
  now,
  clock,
  confirmClear,
  writeClipboard,
  onInsertReply,
}: AiConversationProps): ReactElement {
  const headingId = useId();
  const chat = useTicketAiChat({
    id,
    client,
    createController,
    now,
    clock,
    isSendBlocked: modelControls?.isPending,
    isKnownActive,
    onActivityChange,
  });
  const { isGenerating } = chat;
  const [question, setQuestion] = useState('');
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const showsQuickQuestions = Boolean(
    id && !chat.isReadingHistory && !chat.hasHistoryFailed && !isGenerating && !chat.turns.length,
  );
  const historyRegion = useRef<HTMLDivElement>(null);
  const followsNewMessages = useRef(true);
  const last = chat.current ?? chat.turns.at(-1);
  useLayoutEffect(() => {
    const node = historyRegion.current;
    if (node && followsNewMessages.current) node.scrollTop = node.scrollHeight;
  }, [chat.current, chat.turns, isExpanded]);
  function sendQuestion(question: string): void {
    if (!chat.canSend) return;
    followsNewMessages.current = true;
    void chat.send(question);
  }
  return (
    <section className="ai-conversation" aria-labelledby={headingId}>
      <AiChatHeading
        headingId={headingId}
        isExpanded={isExpanded}
        onToggleExpanded={onToggleExpanded}
        hasTicket={Boolean(id)}
        canClear={chat.canClear}
        isClearing={chat.isClearingHistory}
        hasSaveFailed={chat.hasHistorySaveFailed}
        hasClearFailed={chat.hasHistoryClearFailed}
        confirmClear={confirmClear}
        onClear={chat.clear}
        modelControls={
          modelControls &&
          onModelSettings && (
            <AiChatModelControls
              controls={modelControls}
              isGenerating={isGenerating}
              onSettings={onModelSettings}
            />
          )
        }
      />
      <div
        className="ai-message-history"
        ref={historyRegion}
        role="log"
        aria-label={TICKET_COPY.aiMessageHistory}
        tabIndex={0}
        onScroll={(event) => {
          followsNewMessages.current = canFollowHistory(event.currentTarget);
        }}
      >
        {chat.isReadingHistory && <p className="muted">{AI_CHAT_COPY.historyLoading}</p>}
        {chat.hasHistoryFailed && (
          <div className="ai-chat-actions">
            <p className="muted" role="status">
              {AI_CHAT_COPY.historyFailed}
            </p>
            <Button
              variant="quiet"
              size="small"
              disabled={chat.isReadingHistory}
              onClick={() => void chat.reload()}
            >
              {AI_CHAT_COPY.retry}
            </Button>
          </div>
        )}
        {showsQuickQuestions && (
          <AiQuickQuestions
            onChoose={(text) => {
              setQuestion(text);
              questionInput.current?.focus();
            }}
          />
        )}
        {id &&
          [...chat.turns, ...(chat.current ? [chat.current] : [])].map((turn) => (
            <AiChatTurn
              key={turn.id}
              ticketId={id}
              turn={turn}
              clock={clock}
              now={now}
              onRetry={
                chat.canSend && turn.outcome === 'timeout'
                  ? () => sendQuestion(turn.question)
                  : undefined
              }
              onInsertReply={onInsertReply}
              writeClipboard={writeClipboard}
            />
          ))}
      </div>
      <AiChatComposer
        canCompose={Boolean(id)}
        canSend={chat.canSend}
        isGenerating={isGenerating}
        canStop={chat.canStop}
        isStopping={chat.isStopping}
        hasStopFailed={chat.hasStopFailed}
        summary={last?.summary ?? null}
        question={question}
        inputRef={questionInput}
        onQuestionChange={setQuestion}
        onSend={sendQuestion}
        onStop={() => void chat.stop()}
      />
    </section>
  );
}
