// 渲染中栏回复和草稿操作，允许右栏 AI 回答追加到当前输入。
import { useId, useImperativeHandle } from 'react';
import type { ReactElement, Ref } from 'react';
import { TICKET_DRAFT_MAX_LENGTH } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { GrowingTextarea } from './growing-textarea.tsx';
import { TICKET_REPLY_COPY } from './ticket-reply-copy.ts';
import { TICKET_WRITE_ACTION_LABELS, TICKET_WRITE_COPY } from './ticket-write-copy.ts';
import type { TicketReplyDraftState } from './use-ticket-reply-draft.ts';

/** 填入结果；空间不足或不可编辑时，保留原始草稿。 */
export type TicketReplyFillResult = 'inserted' | 'unavailable' | 'too-long';

/** 中栏供 AI 助手追加回复的接口；追加后自动保存草稿。 */
export type TicketReplyHandle = { fillReply: (text: string) => TicketReplyFillResult };

/** 当前草稿、评论操作状态和供 AI 追加回复的引用。 */
export type TicketReplyEditorProps = {
  draft: TicketReplyDraftState;
  canEdit: boolean;
  canSend: boolean;
  isSending: boolean;
  onSend: () => void;
  replyRef?: Ref<TicketReplyHandle>;
};

/**
 * 在固定的回复区显示草稿与评论入口。审批区与这里共享当前草稿。
 * @param props 草稿状态及受后台可用动作约束的评论回调。
 * @returns 回复卡片；回车保留原生换行。
 * @throws 无预期错误；读取和保存失败在卡片中提示。
 */
export function TicketReplyEditor({
  draft,
  canEdit,
  canSend,
  isSending,
  onSend,
  replyRef,
}: TicketReplyEditorProps): ReactElement {
  const inputId = useId();
  const hintId = useId();
  useImperativeHandle(replyRef, () => ({
    fillReply: (text): TicketReplyFillResult => {
      if (!canEdit || !text.trim()) return 'unavailable';
      const next = draft.text ? `${draft.text}\n\n${text}` : text;
      if (next.length > TICKET_DRAFT_MAX_LENGTH) return 'too-long';
      draft.updateText(next);
      // React 尚未重绘，直接保存拼接结果，避免保存上一轮输入。
      void draft.save(next);
      return 'inserted';
    },
  }));
  return (
    <section className="ticket-reply" aria-label={TICKET_REPLY_COPY.title}>
      <label htmlFor={inputId}>{TICKET_REPLY_COPY.title}</label>
      <GrowingTextarea
        className="ticket-reply-input"
        id={inputId}
        maxLength={TICKET_DRAFT_MAX_LENGTH}
        value={draft.text}
        disabled={!canEdit}
        aria-describedby={hintId}
        onChange={(event) => draft.updateText(event.currentTarget.value)}
      />
      <div className="ticket-reply-actions">
        <div className="ticket-reply-notices">
          <p id={hintId}>{TICKET_REPLY_COPY.localHint}</p>
          {draft.hasReadFailed && (
            <p role="alert">
              {TICKET_REPLY_COPY.loadFailed}
              <Button variant="quiet" size="small" onClick={() => void draft.reload()}>
                {TICKET_REPLY_COPY.retry}
              </Button>
            </p>
          )}
          {draft.hasSaveFailed && <p role="alert">{TICKET_REPLY_COPY.saveFailed}</p>}
          {draft.hasSaved && <p role="status">{TICKET_REPLY_COPY.saved}</p>}
        </div>
        <Button
          variant="quiet"
          disabled={!canEdit || !draft.canSave}
          onClick={() => void draft.save()}
        >
          {draft.isSaving ? TICKET_REPLY_COPY.saving : TICKET_REPLY_COPY.save}
        </Button>
        <Button variant="primary" disabled={!canSend} aria-busy={isSending} onClick={onSend}>
          {isSending ? TICKET_WRITE_COPY.commentSending : TICKET_WRITE_ACTION_LABELS.comment}
        </Button>
      </div>
    </section>
  );
}
