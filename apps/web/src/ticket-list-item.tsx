// 展示左栏单据的来源已核实摘要、可选型号和分组内额外状态。
import type { ReactElement } from 'react';
import type { TicketListItem as TicketListEntry } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { TICKET_COPY, TICKET_TEMPLATE_LABELS } from './ticket-copy.ts';
import { TicketListItemStatus } from './ticket-list-item-status.tsx';
import { formatTicketWait } from './ticket-time.ts';

/** 左栏条目的安全摘要、选中状态、当前时间和选择回调。 */
export type TicketListItemProps = {
  ticket: TicketListEntry;
  isSelected: boolean;
  isAiAnswering: boolean;
  now: number;
  onSelect: (id: string) => void;
};

/**
 * 渲染可用键盘选择的单据卡片，状态只显示分组标题之外的信息。
 * @param props 当前条目及交互依赖。
 * @returns 发起人、模板、已读型号、等待时长和需要显示的附加状态。
 * @throws 无预期错误。
 */
export function TicketListItem({
  ticket,
  isSelected,
  isAiAnswering,
  now,
  onSelect,
}: TicketListItemProps): ReactElement {
  const { initiator, templateName } = ticket;
  const template = TICKET_TEMPLATE_LABELS.get(templateName ?? '') ?? templateName;
  const wait = formatTicketWait({ createdAt: ticket.createdAt, now, isDaysOnly: true });
  const modelAndWait = [ticket.productModel, wait].filter(Boolean).join(TICKET_COPY.countSeparator);
  return (
    <li>
      <Button
        variant="quiet"
        className="ticket-list-item"
        aria-pressed={isSelected}
        onClick={() => onSelect(ticket.id)}
      >
        <span className="ticket-list-item-heading">
          {(initiator || !template) && (
            <strong className="ticket-list-title">{initiator || TICKET_COPY.placeholder}</strong>
          )}
          {template && <span className="ticket-template-tag">{template}</span>}
        </span>
        <span className="ticket-list-wait">{modelAndWait}</span>
        <TicketListItemStatus ticket={ticket} />
        {isAiAnswering && <span className="ticket-verification">{TICKET_COPY.aiAnswering}</span>}
      </Button>
    </li>
  );
}
