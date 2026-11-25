// 读取选中单据并显示头部、关键表单字段与沟通记录，由中栏容器负责滚动。
import { useLayoutEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { isTicketFinished } from '../../../packages/core/src/index.ts';
import type {
  TicketDetailSnapshot,
  TicketListItem,
  TicketRecord,
  TicketSummary,
} from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import { Button } from './button.tsx';
import { TICKET_COPY } from './ticket-copy.ts';
import { TicketFields } from './ticket-fields.tsx';
import type { TicketLocalComment } from './ticket-local-comments.ts';
import { TicketMetadata } from './ticket-metadata.tsx';
import { TICKET_RECORD_COPY } from './ticket-record-copy.ts';
import { TicketRecords } from './ticket-records.tsx';
import { TicketSection } from './ticket-section.tsx';
import { TicketUpdateButton } from './ticket-update-button.tsx';
import { useTicketDetail } from './use-ticket-detail.ts';

/** 最近列表条目、详情读取依赖及定位中栏记录的回调。 */
export type TicketDetailPageProps = {
  ticket: TicketListItem;
  client: WorkbenchClient;
  cacheRevision: string;
  now: number;
  onJumpToRecord: (record: Element) => void;
  onRefreshTicket: () => Promise<void>;
  isRefreshingTicket: boolean;
  updatedDetail?: TicketDetailSnapshot;
  localComments: readonly TicketLocalComment[];
  onReadRecords: (id: string, records: readonly TicketRecord[]) => void;
  decision?: ReactNode;
};

const NO_RECORDS: TicketRecord[] = [];

function getMetadataSummary(
  ticket: TicketListItem,
  detail: TicketSummary | undefined,
): TicketSummary {
  if (!detail) return ticket;
  const hasVerifiedTicket = ticket.verification === 'ready';
  // 详情重读失败时列表仍可能带有已核实的移交状态，避免用旧详情覆盖它。
  const transfer =
    hasVerifiedTicket || typeof ticket.isTransferredOut === 'boolean'
      ? {
          isTransferredToMe: ticket.isTransferredToMe,
          isTransferredOut: ticket.isTransferredOut,
          hasTransferOutActivity: ticket.hasTransferOutActivity,
          transferOutHandlerNames: ticket.transferOutHandlerNames,
        }
      : {};
  return {
    ...detail,
    ...transfer,
    status: isTicketFinished(ticket) ? ticket.status : detail.status,
    sources: ticket.sources,
    progress: hasVerifiedTicket ? ticket.progress : detail.progress,
  };
}

/**
 * 点选时读取详情，预读完成后回取缓存；普通列表轮询不会重复发起现场读取。
 * @param props 单据、客户端、预读版本、当前时间和滚动回调。
 * @returns 常显单据要点和沟通记录，无法读取时显示安全提示。
 * @throws 无；404 和网络错误均转换为安全原因提示。
 */
export function TicketDetailPage({
  ticket,
  client,
  cacheRevision,
  now,
  onJumpToRecord,
  onRefreshTicket,
  isRefreshingTicket,
  updatedDetail,
  localComments,
  onReadRecords,
  decision,
}: TicketDetailPageProps): ReactElement {
  const { result } = useTicketDetail({
    id: ticket.id,
    client,
    cacheRevision,
    updatedDetail,
  });
  const detail = result?.detail;
  const detailRecords = detail?.records;
  const hasReadRecords =
    result?.kind === 'success' ||
    (result?.kind === 'partial' && result.failures?.every(({ part }) => part === 'tasks'));
  // 绘制前替换发出的本机行，实际记录到达时不闪现两条相同评论。
  useLayoutEffect(() => {
    if (detailRecords && hasReadRecords) onReadRecords(ticket.id, detailRecords);
  }, [ticket.id, detailRecords, hasReadRecords, onReadRecords]);
  const records = useRef<HTMLOListElement>(null);
  function jumpToLatest(): void {
    // 直接读取列表最后一个实际记录，目标不受下方 AI 占位高度影响。
    const lastRecord = records.current?.lastElementChild;
    if (lastRecord) onJumpToRecord(lastRecord);
  }
  return (
    <section className="ticket-detail-content" aria-label={TICKET_COPY.detail}>
      <TicketMetadata
        summary={getMetadataSummary(ticket, detail?.summary)}
        businessId={detail?.businessId ?? null}
        now={now}
        onRefreshTicket={onRefreshTicket}
        isRefreshingTicket={isRefreshingTicket}
        decision={decision}
      />
      {detail && (
        <TicketSection title={TICKET_COPY.fields}>
          <TicketFields fields={detail.fields} />
        </TicketSection>
      )}
      {result && !detail && (
        <div className="ticket-detail-unavailable" role="status">
          <p>{TICKET_COPY.detailUnavailable}</p>
          <TicketUpdateButton isRefreshing={isRefreshingTicket} onUpdate={onRefreshTicket} />
        </div>
      )}
      {detail && (
        <TicketSection
          title={TICKET_RECORD_COPY.title}
          action={
            <Button
              size="small"
              variant="quiet"
              disabled={!detailRecords?.length && !localComments.length}
              onClick={jumpToLatest}
            >
              {TICKET_RECORD_COPY.jumpToLatest}
            </Button>
          }
        >
          <TicketRecords
            records={detailRecords ?? NO_RECORDS}
            ticketId={ticket.id}
            client={client}
            now={now}
            listRef={records}
            localComments={localComments}
          />
        </TicketSection>
      )}
    </section>
  );
}
