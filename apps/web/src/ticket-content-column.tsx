// 提供中栏单据滚动区和固定回复位置，保留跨单据的本机评论与写入结果。
import { useState } from 'react';
import type { ReactElement, Ref } from 'react';
import type { TicketDetailSnapshot, TicketWriteOutcome } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { TicketContentCards } from './ticket-content-cards.tsx';
import { TICKET_COPY } from './ticket-copy.ts';
import { TicketReadNotice } from './ticket-read-notice.tsx';
import type { TicketReplyHandle } from './ticket-reply-editor.tsx';
import { getTicketWriteOutcomeLabel } from './ticket-write-copy.ts';
import { useTicketComments } from './use-ticket-comments.ts';
import type { TicketSelection } from './use-ticket-selection.ts';
import type { TicketWriteResultEvent } from './use-ticket-write.ts';
import './ticket-reply.css';

/** 供右栏 AI 助手追加中栏回复的接口。 */
export type { TicketReplyHandle } from './ticket-reply-editor.tsx';

/** 当前选择、同源客户端、时间和可替换的记录定位操作。 */
export type TicketContentColumnProps = {
  selection: TicketSelection;
  client: WorkbenchClient;
  now: number;
  getNow?: () => number;
  clock?: PollingClock;
  replyRef?: Ref<TicketReplyHandle>;
  onWriteCompleted?: () => Promise<void>;
  onRefreshTicket: () => Promise<void>;
  isRefreshingTicket: boolean;
  updatedDetail?: TicketDetailSnapshot;
  scrollToRecord?: (options: { container: HTMLDivElement; record: Element }) => void;
};

function scrollColumnToRecord({
  container,
  record,
}: {
  container: HTMLDivElement;
  record: Element;
}): void {
  // 仅移动中栏，避免 scrollIntoView 同时滚动页面或右栏。
  container.scrollTop +=
    record.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    container.clientTop;
}

/**
 * 选中单据时装载独立的详情和草稿状态，以原有读写方式保留本机评论。
 * @param props 当前单据选择和可替换页面依赖。
 * @returns 三栏中间列的卡片或空态。
 * @throws 无预期错误；读取错误由详情组件显示。
 */
export function TicketContentColumn(props: TicketContentColumnProps): ReactElement {
  const {
    selection,
    client,
    getNow = Date.now,
    onWriteCompleted,
    scrollToRecord = scrollColumnToRecord,
  } = props;
  const comments = useTicketComments({ client, now: getNow, onCompleted: onWriteCompleted });
  const [outcomes, setOutcomes] = useState(() => new Map<string, TicketWriteOutcome>());
  function showWriteResult({ id, outcome }: TicketWriteResultEvent): void {
    setOutcomes((previous) => new Map(previous).set(id, outcome));
    if (outcome.kind === 'completed') void onWriteCompleted?.();
  }
  const ticket = selection.selected;
  const missingTicketOutcome = selection.selectedId
    ? outcomes.get(selection.selectedId)
    : undefined;
  return (
    <div className="ticket-content-column">
      {ticket ? (
        <TicketContentCards
          {...props}
          key={ticket.id}
          ticket={ticket}
          cacheRevision={selection.cacheRevision}
          comments={comments}
          outcome={outcomes.get(ticket.id)}
          onWriteResult={showWriteResult}
          scrollToRecord={scrollToRecord}
        />
      ) : selection.selectedId ? (
        <>
          <TicketReadNotice reason="not-found" fallback={TICKET_COPY.detailUnavailable} />
          {missingTicketOutcome && (
            <p className="ticket-write-result" role="status">
              {getTicketWriteOutcomeLabel(missingTicketOutcome)}
            </p>
          )}
        </>
      ) : (
        <p className="ticket-empty">{TICKET_COPY.noSelection}</p>
      )}
    </div>
  );
}
