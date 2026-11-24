// 展示后台单据快照、预读进度或窄边栏，负责三栏工作台的左侧区域。
import type { ReactElement } from 'react';
import { TICKET_GROUP_ORDER } from '../../../packages/core/src/index.ts';
import type { TicketListSnapshot } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import type { PollingClock } from './polling-clock.ts';
import { TICKET_COPY } from './ticket-copy.ts';
import { TicketGroup } from './ticket-group.tsx';
import { TicketListHeader } from './ticket-list-header.tsx';
import { TicketReadNotice } from './ticket-read-notice.tsx';

/** 左栏的只读快照、展开状态及交互入口。 */
export type TicketListPageProps = {
  snapshot: TicketListSnapshot | null;
  isRequesting: boolean;
  isDingtalkReady: boolean;
  selectedId: string | null;
  activeAiTickets: ReadonlySet<string>;
  now: number;
  getNow?: () => number;
  clock?: PollingClock;
  isExpanded: boolean;
  isToggleDisabled: boolean;
  contentId: string;
  onToggle: () => void;
  onRefresh: () => Promise<void>;
  onSelect: (id: string) => void;
};

/**
 * 立即显示现有快照，并逐次反映后台预读进度和排序变化。
 * @param props 内存快照、当前选择、时钟、展开状态与刷新回调。
 * @returns 独立滚动的单据列表或标记左栏位置的窄边栏。
 * @throws 无预期错误；失败与部分读取不会作为空成功展示。
 */
export function TicketListPage({
  snapshot,
  isRequesting,
  isDingtalkReady,
  selectedId,
  activeAiTickets,
  now,
  getNow,
  clock,
  isExpanded,
  isToggleDisabled,
  contentId,
  onToggle,
  onRefresh,
  onSelect,
}: TicketListPageProps): ReactElement {
  const items = snapshot?.items ?? [];
  return (
    <aside className="workbench-column ticket-list-column" aria-label={TICKET_COPY.title}>
      {!isExpanded && (
        <Button
          className="ticket-list-rail"
          variant="quiet"
          size="small"
          aria-label={`${TICKET_COPY.expandList}${TICKET_COPY.countSeparator}${items.length}`}
          aria-expanded="false"
          aria-controls={contentId}
          disabled={isToggleDisabled}
          onClick={onToggle}
        >
          <span className="ticket-list-icon" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{TICKET_COPY.listRail}</span>
          <span className="ticket-group-tag" aria-hidden="true">
            {items.length}
          </span>
        </Button>
      )}
      <div id={contentId} hidden={!isExpanded}>
        <TicketListHeader
          snapshot={snapshot}
          isRequesting={isRequesting}
          isDingtalkReady={isDingtalkReady}
          getNow={getNow}
          clock={clock}
          contentId={contentId}
          onToggle={onToggle}
          onRefresh={onRefresh}
        />
        {snapshot && snapshot.kind !== 'loading' && <TicketReadNotice reason={snapshot.reason} />}
        {TICKET_GROUP_ORDER.map((group) => (
          <TicketGroup
            key={group}
            group={group}
            items={items.filter((ticket) => ticket.group === group)}
            selectedId={selectedId}
            activeAiTickets={activeAiTickets}
            now={now}
            onSelect={onSelect}
          />
        ))}
        {snapshot?.kind === 'success' && items.length === 0 && (
          <p className="ticket-empty">{TICKET_COPY.successEmpty}</p>
        )}
      </div>
    </aside>
  );
}
