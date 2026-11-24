// 按后台已排序的时间线展示沟通列表，滚动由三栏工作台的中栏负责。
import type { ReactElement, Ref } from 'react';
import type { TicketRecord } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import { TicketComment } from './ticket-comment.tsx';
import type { TicketLocalComment } from './ticket-local-comments.ts';
import { TICKET_RECORD_COPY } from './ticket-record-copy.ts';
import { TicketSystemRecord } from './ticket-system-record.tsx';
import { useTicketImages } from './use-ticket-images.ts';

/** 安全记录、毫秒级当前时间及供定位使用的列表引用。 */
export type TicketRecordsProps = {
  records: readonly TicketRecord[];
  ticketId: string;
  client: WorkbenchClient;
  localComments: readonly TicketLocalComment[];
  now: number;
  listRef: Ref<HTMLOListElement>;
};

/**
 * 显示评论气泡与系统行，按顺序排版在单据内容中。
 * @param props 后台已排序的记录、当前时间和列表引用。
 * @returns 常显的沟通列表或空记录提示。
 * @throws 无预期错误。
 */
export function TicketRecords({
  records,
  ticketId,
  client,
  localComments,
  now,
  listRef,
}: TicketRecordsProps): ReactElement {
  const images = useTicketImages({ ticketId, client });
  if (!records.length && !localComments.length)
    return <p className="muted">{TICKET_RECORD_COPY.empty}</p>;
  return (
    <ol className="ticket-communication-list" ref={listRef}>
      {records.map((record, index) =>
        record.kind === 'comment' ? (
          <TicketComment key={index} record={record} now={now} images={images} />
        ) : (
          <TicketSystemRecord key={index} record={record} now={now} images={images} />
        ),
      )}
      {localComments.map((local) => (
        <TicketComment key={`local:${local.key}`} local={local} now={now} />
      ))}
    </ol>
  );
}
