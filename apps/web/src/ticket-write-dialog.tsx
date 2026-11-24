// 显示写入钉钉前的可编辑意见及一次性确认，供中栏审批使用。
import { useId } from 'react';
import type { ReactElement } from 'react';
import { TICKET_WRITE_TEXT_LIMIT } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { TICKET_COPY } from './ticket-copy.ts';
import { formatTicketUpdate } from './ticket-time.ts';
import { TicketUpdateButton } from './ticket-update-button.tsx';
import { TICKET_WRITE_COPY } from './ticket-write-copy.ts';
import { useModalDialog } from './use-modal-dialog.ts';
import type { TicketWriteReview } from './use-ticket-write.ts';

/** 当前核对内容、列表预读的备用标题和时间，以及显式确认动作。 */
export type TicketWriteDialogProps = {
  review: TicketWriteReview;
  ticketName: string;
  detailReadAt: string | null;
  message: string;
  isPreparing: boolean;
  isExecuting: boolean;
  isRefreshing: boolean;
  now: number;
  canConfirm: boolean;
  onChangeText: (text: string) => void;
  onRefresh: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * 以原生模态层展示要提交的单据和意见，实际执行仍由现有确认码门禁处理。
 * @param props 绑定当前单据的核对数据和用户操作。
 * @returns 可取消的审批确认；换单或完成后关闭。
 * @throws 无预期错误；网络失败由固定反馈显示。
 */
export function TicketWriteDialog(props: TicketWriteDialogProps): ReactElement {
  const {
    review,
    ticketName,
    detailReadAt,
    message,
    isPreparing,
    isExecuting,
    isRefreshing,
    now,
    canConfirm,
    onChangeText,
    onRefresh,
    onConfirm,
    onCancel,
  } = props;
  const dialog = useModalDialog();
  const headingId = useId();
  const warningId = useId();
  const textId = useId();
  const isRejection = review.action === 'reject';
  const readAt = review.detailReadAt ?? detailReadAt;
  return (
    <dialog
      className="ticket-write-dialog"
      ref={dialog}
      aria-labelledby={headingId}
      aria-describedby={warningId}
      onCancel={(event) => {
        event.preventDefault();
        if (!isExecuting) onCancel();
      }}
    >
      <div className="ticket-write-dialog-body">
        <h2 id={headingId}>
          {isRejection ? TICKET_WRITE_COPY.rejectHeading : TICKET_WRITE_COPY.approveHeading}
        </h2>
        <div className="ticket-write-summary">
          <p>{review.ticketName ?? ticketName}</p>
          <div className="ticket-write-read-time">
            <time dateTime={readAt ?? undefined}>
              {formatTicketUpdate({
                updatedAt: readAt,
                now,
                copy: {
                  missing: TICKET_WRITE_COPY.readTimeMissing,
                  minutesAgo: TICKET_WRITE_COPY.readMinutesAgo,
                },
              })}
            </time>
            <span aria-hidden="true">{TICKET_COPY.countSeparator}</span>
            <TicketUpdateButton
              isRefreshing={isRefreshing}
              isDisabled={isPreparing || isExecuting}
              variant="quiet"
              onUpdate={onRefresh}
            />
          </div>
        </div>
        <div className="ticket-write-opinion">
          <label htmlFor={textId}>
            {isRejection ? TICKET_WRITE_COPY.rejectOpinion : TICKET_WRITE_COPY.approveOpinion}
          </label>
          <textarea
            id={textId}
            rows={4}
            maxLength={TICKET_WRITE_TEXT_LIMIT}
            value={review.text}
            required={isRejection}
            disabled={isPreparing || isExecuting || isRefreshing || review.isStale}
            onChange={(event) => onChangeText(event.currentTarget.value)}
          />
        </div>
        <p className="ticket-write-warning" id={warningId}>
          {TICKET_WRITE_COPY.warning}
        </p>
        {message && (
          <p className="muted" role="status">
            {message}
          </p>
        )}
        <div className="ticket-write-dialog-actions">
          <Button variant="secondary" disabled={isExecuting} onClick={onCancel}>
            {TICKET_WRITE_COPY.cancel}
          </Button>
          <Button
            variant={isRejection ? 'reject-solid' : 'approve'}
            aria-busy={isPreparing || isExecuting}
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {isExecuting ? TICKET_WRITE_COPY.executing : TICKET_WRITE_COPY.confirm}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
