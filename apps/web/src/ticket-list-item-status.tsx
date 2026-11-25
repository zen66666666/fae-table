// 渲染左栏单据卡片的附加状态，由单据列表项使用。
import type { ReactElement } from 'react';
import type { TicketListItem } from '../../../packages/core/src/index.ts';
import { TICKET_COPY, TICKET_PROGRESS_LABELS, TICKET_REPLY_STATUS_LABELS } from './ticket-copy.ts';

/** 当前卡片的分组、流程进度和后台已核实的状态。 */
export type TicketListItemStatusProps = { ticket: TicketListItem };

function getVerificationLabel(ticket: TicketListItem): string | null {
  const { verification, failures } = ticket;
  if (verification === 'pending') return TICKET_COPY.prefetchPending;
  // 辅助信息读失败时仍有可用详情，只在详情主体缺失时显示未读到。
  const hasFailedDetail = !failures?.length || failures.some(({ part }) => part === 'detail');
  return verification === 'failed' && hasFailedDetail ? TICKET_COPY.prefetchUnavailable : null;
}

function renderStepBadge(progress: TicketListItem['progress']): ReactElement | null {
  const step = progress?.steps[progress.currentIndex];
  if (!step || !progress) return null;
  const tone = progress.state === 'waiting-for-others' ? 'finished' : 'awaiting-receipt';
  return (
    <span className={`ticket-group-tag ticket-group-tag--${tone}`}>
      {step.shortName}
      {TICKET_COPY.countSeparator}
      {TICKET_PROGRESS_LABELS[progress.state]}
    </span>
  );
}

/**
 * 显示当前步骤及分组相关状态；已转出单据使用对方的动态和已核实姓名。
 * @param props 当前左栏条目的全部安全字段。
 * @returns 卡片的附加状态行，无状态时为空。
 * @throws 无预期错误。
 */
export function TicketListItemStatus({ ticket }: TicketListItemStatusProps): ReactElement | null {
  const { group, replyStatus, progress, transferOutHandlerNames } = ticket;
  const stepBadge = renderStepBadge(progress);
  if (group === 'transferred-out') {
    const hasActivity = ticket.hasTransferOutActivity === true;
    const names = transferOutHandlerNames ?? [];
    const name = names[0];
    const handler = name && TICKET_COPY.formatTransferOutHandler(name, names.length);
    return (
      <span className="ticket-list-tags ticket-list-tags--transfer-out">
        {stepBadge}
        <span
          className={`ticket-group-tag${hasActivity ? ' ticket-group-tag--transfer-activity' : ''}`}
        >
          {hasActivity ? TICKET_COPY.transferOutActivity : TICKET_COPY.transferOutQuiet}
        </span>
        {handler && (
          <span className="ticket-list-transfer-handler" title={handler}>
            {handler}
          </span>
        )}
      </span>
    );
  }
  const hasStatus =
    group === 'transferred' || (group === 'replied' && replyStatus === 'awaiting-others');
  const verificationLabel = getVerificationLabel(ticket);
  if (!hasStatus && !stepBadge && !verificationLabel) return null;
  return (
    <span className="ticket-list-tags">
      {hasStatus && (
        <span className={`ticket-group-tag ticket-group-tag--${replyStatus}`}>
          {TICKET_REPLY_STATUS_LABELS[replyStatus]}
        </span>
      )}
      {stepBadge}
      {verificationLabel && <span className="ticket-verification">{verificationLabel}</span>}
    </span>
  );
}
