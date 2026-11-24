// 将后台已经排序的条目放入优先级分组，已结束分组默认折叠。
import type { ReactElement } from 'react';
import type {
  TicketGroup as TicketGroupName,
  TicketListItem as TicketListEntry,
} from '../../../packages/core/src/index.ts';
import { TICKET_GROUP_LABELS } from './ticket-copy.ts';
import { TicketListItem } from './ticket-list-item.tsx';

/** 单组条目、选中标识和可替换当前时间；列表顺序由后台确定。 */
export type TicketGroupProps = {
  group: TicketGroupName;
  items: TicketListEntry[];
  selectedId: string | null;
  activeAiTickets: ReadonlySet<string>;
  now: number;
  onSelect: (id: string) => void;
};

/**
 * 渲染单据分组，并允许用户展开已结束的历史单据。
 * @param props 分组名称及只读条目。
 * @returns 分组标题与可选条目，已结束分组初始收起。
 * @throws 无预期错误。
 */
export function TicketGroup({
  group,
  items,
  selectedId,
  activeAiTickets,
  now,
  onSelect,
}: TicketGroupProps): ReactElement {
  const label = TICKET_GROUP_LABELS[group];
  const title = (
    <>
      {label}
      <span className={`ticket-group-tag ticket-group-tag--${group}`}>{items.length}</span>
    </>
  );
  const content = (
    <ul className="ticket-list">
      {items.map((ticket) => (
        <TicketListItem
          key={ticket.id}
          ticket={ticket}
          isSelected={ticket.id === selectedId}
          isAiAnswering={activeAiTickets.has(ticket.id)}
          now={now}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
  return group === 'finished' ? (
    <details className="ticket-group ticket-group--finished">
      <summary>
        {title}
        <span className="ticket-group-arrow" aria-hidden="true" />
      </summary>
      {content}
    </details>
  ) : (
    <section className="ticket-group" aria-label={label}>
      <h2>{title}</h2>
      {content}
    </section>
  );
}
