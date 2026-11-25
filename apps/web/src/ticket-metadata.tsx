// 组合中栏单据标题、业务状态和独立审批操作，详情未读到也可显示标题。
import type { ReactElement, ReactNode } from 'react';
import {
  getTicketGroup,
  getTicketHeading,
  getTicketReplyStatus,
} from '../../../packages/core/src/index.ts';
import type {
  TicketGroup,
  TicketReplyStatus,
  TicketSummary,
} from '../../../packages/core/src/index.ts';
import { TicketBusinessId } from './ticket-business-id.tsx';
import { TICKET_COPY, TICKET_GROUP_LABELS, TICKET_REPLY_STATUS_LABELS } from './ticket-copy.ts';
import { TicketProgressStrip } from './ticket-progress-strip.tsx';
import { formatTicketDate, formatTicketWait } from './ticket-time.ts';
import { TicketUpdateButton } from './ticket-update-button.tsx';

const STARTED_DATE_SUFFIX = ' 发起';

/** 当前摘要、审批编号及同一单据的刷新和审批入口。 */
export type TicketMetadataProps = {
  summary: TicketSummary;
  businessId: string | null;
  now: number;
  onRefreshTicket: () => Promise<void>;
  isRefreshingTicket: boolean;
  decision?: ReactNode;
};

function getStatusPill(summary: TicketSummary): {
  tone: TicketGroup | TicketReplyStatus;
  label: string;
} {
  const replyStatus = getTicketReplyStatus(summary);
  const group = getTicketGroup(summary, replyStatus);
  if (group === 'finished') return { tone: group, label: TICKET_GROUP_LABELS.finished };
  if (group === 'transferred-out') return { tone: group, label: TICKET_COPY.transferredOut };
  const status = TICKET_REPLY_STATUS_LABELS[replyStatus];
  return group === 'transferred'
    ? {
        tone: group,
        label: `${TICKET_GROUP_LABELS.transferred}${TICKET_COPY.countSeparator}${status}`,
      }
    : { tone: replyStatus, label: status };
}

/**
 * 展示发起人和模板、可复制的审批编号、日期、状态及操作。
 * @param props 当前安全摘要和已核实的操作区域。
 * @returns 中栏标题卡片；标题不回退为实例标识。
 * @throws 无预期错误。
 */
export function TicketMetadata({
  summary,
  businessId,
  now,
  onRefreshTicket,
  isRefreshingTicket,
  decision,
}: TicketMetadataProps): ReactElement {
  const { tone, label } = getStatusPill(summary);
  const { createdAt } = summary;
  return (
    <header className="ticket-header">
      <div className="ticket-header-text">
        <h2 className="ticket-detail-title">{getTicketHeading(summary)}</h2>
        <div className="ticket-metadata">
          {businessId && <TicketBusinessId key={businessId} businessId={businessId} />}
          <time
            className="ticket-meta-pill"
            dateTime={createdAt ?? undefined}
            title={TICKET_COPY.createdAt}
          >
            {createdAt ? formatTicketDate(createdAt) : TICKET_COPY.placeholder}
            {STARTED_DATE_SUFFIX}
            {TICKET_COPY.countSeparator}
            {formatTicketWait({ createdAt, now, isDaysOnly: true })}
          </time>
          <span
            className={`ticket-meta-pill ticket-group-tag ticket-group-tag--${tone}`}
            title={TICKET_COPY.status}
          >
            {label}
          </span>
        </div>
        {tone !== 'finished' && summary.progress && (
          <TicketProgressStrip progress={summary.progress} />
        )}
      </div>
      <div className="ticket-header-actions">
        {decision}
        <TicketUpdateButton isRefreshing={isRefreshingTicket} onUpdate={onRefreshTicket} />
      </div>
    </header>
  );
}
