// 管理右栏固定的提问框、键盘发送、停止和可折叠资料概要。
import type { ReactElement, Ref } from 'react';
import { AI_CHAT_QUESTION_LIMIT } from '../../../packages/core/src/index.ts';
import type { AiChatSummary } from '../../../packages/core/src/index.ts';
import { AiChatContext } from './ai-chat-context.tsx';
import { AI_CHAT_COPY } from './ai-chat-copy.ts';
import { Button } from './button.tsx';
import { GrowingTextarea } from './growing-textarea.tsx';
import { TICKET_COPY } from './ticket-copy.ts';

const IME_KEY_CODE = 229;

/** 当前选中、生成状态、资料概要及发送和取消入口。 */
export type AiChatComposerProps = {
  canCompose: boolean;
  canSend: boolean;
  isGenerating: boolean;
  canStop: boolean;
  isStopping: boolean;
  hasStopFailed: boolean;
  summary: AiChatSummary | null;
  question: string;
  inputRef: Ref<HTMLTextAreaElement>;
  onQuestionChange: (text: string) => void;
  onSend: (question: string) => void;
  onStop: () => void;
};

/**
 * 提供提问、Enter 发送、Shift+Enter 换行与生成期间的停止动作。
 * @param props 已选择状态、概要和受控操作。
 * @returns 固定在助手底部的提问表单。
 * @throws 无预期错误。
 */
export function AiChatComposer({
  canCompose,
  canSend,
  isGenerating,
  canStop,
  isStopping,
  hasStopFailed,
  summary,
  question,
  inputRef,
  onQuestionChange,
  onSend,
  onStop,
}: AiChatComposerProps): ReactElement {
  const isSendDisabled = !canSend || isGenerating || !question.trim();
  function submit(): void {
    if (isSendDisabled) return;
    onSend(question);
    onQuestionChange('');
  }
  return (
    <form
      className="ai-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {summary && <AiChatContext summary={summary} />}
      <div className="ai-composer-bar">
        <GrowingTextarea
          className="ai-composer-input"
          inputRef={inputRef}
          disabled={!canCompose}
          aria-label={TICKET_COPY.aiInput}
          placeholder={AI_CHAT_COPY.placeholder}
          maxLength={AI_CHAT_QUESTION_LIMIT}
          value={question}
          onChange={(event) => onQuestionChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            const keyboard = event.nativeEvent;
            // Windows 输入法可能只报告 229，确认候选字时不得清空或发送。
            if (
              event.key !== 'Enter' ||
              event.shiftKey ||
              keyboard.isComposing ||
              keyboard.keyCode === IME_KEY_CODE
            )
              return;
            event.preventDefault();
            submit();
          }}
        />
        <div className="ai-composer-actions">
          {isGenerating ? (
            <Button disabled={!canStop} onClick={onStop}>
              {isStopping ? AI_CHAT_COPY.stopping : AI_CHAT_COPY.stop}
            </Button>
          ) : (
            <Button variant="primary" type="submit" disabled={isSendDisabled}>
              {AI_CHAT_COPY.send}
            </Button>
          )}
        </div>
      </div>
      {hasStopFailed && (
        <p className="ai-composer-privacy" role="status">
          {AI_CHAT_COPY.stopFailed}
        </p>
      )}
      <p className="ai-composer-privacy">{AI_CHAT_COPY.privacy}</p>
    </form>
  );
}
