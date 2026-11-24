// 连接单张单据的内容卡片、回复草稿和审批确认，切换单据时整体重置。
import { useLayoutEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { getTicketHeading, isTicketFinished } from '../../../packages/core/src/index.ts';
import type { TicketListItem, TicketWriteOutcome } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import type { TicketContentColumnProps } from './ticket-content-column.tsx';
import { TicketDetailPage } from './ticket-detail-page.tsx';
import type { TicketLocalComment } from './ticket-local-comments.ts';
import { TicketReplyEditor } from './ticket-reply-editor.tsx';
import { TicketWriteControls } from './ticket-write-controls.tsx';
import { getTicketWriteOutcomeLabel, TICKET_WRITE_COPY } from './ticket-write-copy.ts';
import { TicketWriteDialog } from './ticket-write-dialog.tsx';
import { useTicketContentActions } from './use-ticket-content-actions.ts';
import type { TicketComments } from './use-ticket-comments.ts';
import type { TicketWriteResultEvent } from './use-ticket-write.ts';

type CardOptions = Pick<
  TicketContentColumnProps,
  | 'client'
  | 'now'
  | 'clock'
  | 'replyRef'
  | 'onRefreshTicket'
  | 'isRefreshingTicket'
  | 'updatedDetail'
> & {
  ticket: TicketListItem;
  cacheRevision: string;
  comments: TicketComments;
  outcome?: TicketWriteOutcome;
  onWriteResult: (event: TicketWriteResultEvent) => void;
  scrollToRecord: NonNullable<TicketContentColumnProps['scrollToRecord']>;
};

const EMPTY_LOCAL_COMMENTS: readonly TicketLocalComment[] = [];

/**
 * 1. 读取当前单据操作和草稿；2. 挂载卡片；3. 新评论提交后定位到相应气泡。
 * @param options 当前已选单据及其同源客户端、回复状态与滚动依赖。
 * @returns 单一详情滚动区、固定回复区和审批确认框。
 * @throws 无预期错误；操作失败在相应卡片中显示。
 */
export function TicketContentCards(options: CardOptions): ReactElement {
  const { ticket, client, cacheRevision, now, comments, scrollToRecord, outcome } = options;
  const column = useRef<HTMLDivElement>(null);
  const pendingJump = useRef<number | null>(null);
  const local = comments.views.get(ticket.id);
  const localComments = local?.comments ?? EMPTY_LOCAL_COMMENTS;
  const isPending = ticket.sources.includes('pending') && !isTicketFinished(ticket);
  // 1. 两处按钮读取同一份权限，审批意见和评论使用同一个草稿。
  const actions = useTicketContentActions({
    ...options,
    id: ticket.id,
    cacheRevision: `${cacheRevision}:${isPending}`,
    commentDraft: local?.draft,
    onEditAfterSend: comments.updateDraft,
    onSendComment: (input) => {
      const key = comments.send(input);
      if (key !== null) pendingJump.current = key;
      return key;
    },
  });
  const { write } = actions;
  function jumpToRecord(record: Element): void {
    if (column.current?.contains(record)) scrollToRecord({ container: column.current, record });
  }
  useLayoutEffect(() => {
    const key = pendingJump.current;
    pendingJump.current = null;
    const container = column.current;
    if (key === null || !container) return;
    // 3. 等 React 挂载新的气泡，避免移动已经切走的单据视图。
    const record = container.querySelector(`[data-local-comment="${key}"]`);
    if (record) scrollToRecord({ container, record });
  }, [localComments, scrollToRecord]);
  // 2. 回复区与确认框在详情滚动区之外。
  return (
    <>
      <div ref={column} className="workbench-column ticket-content-scroll">
        <TicketDetailPage
          ticket={ticket}
          client={client}
          cacheRevision={cacheRevision}
          now={now}
          onJumpToRecord={jumpToRecord}
          localComments={localComments}
          onReadRecords={comments.observeRecords}
          onRefreshTicket={options.onRefreshTicket}
          isRefreshingTicket={options.isRefreshingTicket}
          updatedDetail={options.updatedDetail}
          decision={
            isPending && (
              <TicketWriteControls
                actions={actions.actions}
                progress={ticket.progress}
                isDisabled={!actions.canEdit || actions.isBusy || options.isRefreshingTicket}
                onSelect={(action) => write.begin(action, actions.draft.text)}
              />
            )
          }
        />
      </div>
      {actions.hasActionsFailed && (
        <div className="ticket-action-notice" role="status">
          {TICKET_WRITE_COPY.actionsFailed}
          <Button variant="quiet" size="small" onClick={() => void actions.reloadActions()}>
            {TICKET_WRITE_COPY.retryActions}
          </Button>
        </div>
      )}
      {outcome && (
        <p className="ticket-write-result" role="status">
          {getTicketWriteOutcomeLabel(outcome)}
        </p>
      )}
      <TicketReplyEditor
        draft={actions.draft}
        canEdit={actions.canEdit}
        canSend={actions.canSend}
        isSending={actions.isSending}
        onSend={actions.sendComment}
        replyRef={options.replyRef}
      />
      {write.review && (
        <TicketWriteDialog
          review={write.review}
          ticketName={getTicketHeading(ticket)}
          detailReadAt={ticket.detailReadAt ?? null}
          message={write.message}
          isPreparing={write.isPreparing}
          isExecuting={write.isExecuting}
          isRefreshing={write.isRefreshing}
          now={now}
          canConfirm={write.canConfirm}
          onChangeText={write.updateText}
          onRefresh={() => void write.refresh()}
          onConfirm={() => void write.confirm()}
          onCancel={write.cancel}
        />
      )}
    </>
  );
}
