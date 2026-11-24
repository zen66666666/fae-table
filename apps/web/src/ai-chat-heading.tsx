// 展示 AI 助手的模型、布局切换和记录管理控件，由右栏对话使用。
import type { ReactElement, ReactNode } from 'react';
import { AI_CHAT_COPY } from './ai-chat-copy.ts';
import { Button } from './button.tsx';
import { TICKET_COPY } from './ticket-copy.ts';

/** 对话区标题、布局切换、记录清空状态及可替换的确认动作。 */
export type AiChatHeadingProps = {
  headingId: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  hasTicket: boolean;
  canClear: boolean;
  isClearing: boolean;
  hasSaveFailed: boolean;
  hasClearFailed: boolean;
  modelControls?: ReactNode;
  onClear: () => Promise<void>;
  confirmClear?: (message: string) => boolean;
};

function confirmInBrowser(message: string): boolean {
  return window.confirm(message);
}

/**
 * 显示模型及布局切换，在用户确认一次后发起清空。
 * @param props 布局状态、当前单据清空状态与可替换的浏览器确认实现。
 * @returns 右栏 AI 助手标题和操作行。
 * @throws 无预期错误；网络失败由对话状态报告。
 */
export function AiChatHeading({
  headingId,
  isExpanded,
  onToggleExpanded,
  hasTicket,
  canClear,
  isClearing,
  hasSaveFailed,
  hasClearFailed,
  modelControls,
  onClear,
  confirmClear = confirmInBrowser,
}: AiChatHeadingProps): ReactElement {
  return (
    <header className="ai-conversation-heading">
      <h2 id={headingId}>{TICKET_COPY.aiConversation}</h2>
      {modelControls}
      <div className="ai-conversation-heading-actions">
        {hasTicket && (
          <Button
            variant="quiet"
            size="small"
            className="ai-clear-current"
            disabled={!canClear}
            onClick={() => {
              if (confirmClear(AI_CHAT_COPY.clearHistoryConfirm)) void onClear();
            }}
          >
            {isClearing ? AI_CHAT_COPY.clearingHistory : AI_CHAT_COPY.clearHistory}
          </Button>
        )}
        <Button variant="quiet" size="small" aria-pressed={isExpanded} onClick={onToggleExpanded}>
          {isExpanded ? AI_CHAT_COPY.collapseAssistant : AI_CHAT_COPY.expandAssistant}
        </Button>
      </div>
      {hasSaveFailed && <p role="status">{AI_CHAT_COPY.historySaveFailed}</p>}
      {hasClearFailed && <p role="status">{AI_CHAT_COPY.historyClearFailed}</p>}
    </header>
  );
}
