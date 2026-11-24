// 让中栏标题的审批区与底部评论区共享同一单据的草稿和后台动作门禁。
import type { TicketWriteAction } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import type { TicketCommentDraft } from './ticket-local-comments.ts';
import { canSendTicketComment } from './use-ticket-comments.ts';
import type { TicketComments } from './use-ticket-comments.ts';
import { useTicketReplyDraft } from './use-ticket-reply-draft.ts';
import type { TicketReplyDraftState } from './use-ticket-reply-draft.ts';
import { useTicketWrite } from './use-ticket-write.ts';
import type { TicketWriteResultEvent, TicketWriteState } from './use-ticket-write.ts';
import { useTicketWriteAvailability } from './use-ticket-write-availability.ts';

type ContentActionsOptions = {
  id: string;
  client: WorkbenchClient;
  cacheRevision: string;
  clock?: PollingClock;
  commentDraft?: TicketCommentDraft;
  isRefreshingTicket: boolean;
  onRefreshTicket: () => Promise<void>;
  onEditAfterSend: TicketComments['updateDraft'];
  onSendComment: TicketComments['send'];
  onWriteResult: (event: TicketWriteResultEvent) => void;
};

type ContentActions = {
  actions: TicketWriteAction[];
  draft: TicketReplyDraftState;
  write: TicketWriteState;
  canEdit: boolean;
  canSend: boolean;
  isSending: boolean;
  isBusy: boolean;
  hasActionsFailed: boolean;
  reloadActions: () => Promise<void>;
  sendComment: () => void;
};

/**
 * 1. 读取本单草稿和权限。2. 复用原有确认流程。3. 仅在评论启动后清除当前输入。
 * @param options 已选单据、草稿状态、同源客户端和写入回调。
 * @returns 同一单据的可用动作及草稿操作。
 * @throws 无预期错误；网络状态在评论、草稿和审批反馈中显示。
 */
export function useTicketContentActions(options: ContentActionsOptions): ContentActions {
  // 1. 标题和回复区共用后台权限快照，不从展示分组推断写入许可。
  const { id, client, cacheRevision, clock, commentDraft, onEditAfterSend } = options;
  const draft = useTicketReplyDraft({ id, client, commentDraft, onEditAfterSend });
  const availability = useTicketWriteAvailability({ id, cacheRevision, client, clock });
  const available =
    availability.result && 'actions' in availability.result ? availability.result : null;
  const actions = available?.actions ?? [];
  const isSavingWrite = available?.isBusy === true;
  const isSending = commentDraft?.state === 'sending';
  const isBusy = isSavingWrite || isSending;
  // 2. 确认内容、确认码和原有后台执行门禁保持同一个调用链。
  const write = useTicketWrite({
    id,
    client,
    actions,
    isBusy,
    isRefreshingTicket: options.isRefreshingTicket,
    onRefreshTicket: options.onRefreshTicket,
    onResult: (event) => {
      options.onWriteResult(event);
      if (event.outcome.kind === 'changed') void availability.reload();
    },
  });
  const canEdit = draft.canEdit && !write.review && !write.isPreparing;
  const canSend =
    canEdit && !isBusy && actions.includes('comment') && canSendTicketComment(draft.text);
  return {
    actions,
    draft,
    write,
    canEdit,
    canSend,
    isSending,
    isBusy,
    hasActionsFailed: availability.result !== null && available === null,
    reloadActions: availability.reload,
    sendComment: () => {
      if (!canSend) return;
      // 3. 未实际开始发送时仍保留用户输入。
      if (options.onSendComment({ id, text: draft.text, savedText: draft.savedText }) !== null)
        draft.clearForComment();
    },
  };
}
