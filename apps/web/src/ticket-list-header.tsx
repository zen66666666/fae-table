// 展示左栏的刷新倒计时、更新入口及读取结果，供单据列表使用。
import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { TicketListSnapshot } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import type { PollingClock } from './polling-clock.ts';
import { TICKET_COUNTDOWN_INTERVAL_MS } from './ticket-constants.ts';
import { TICKET_COPY } from './ticket-copy.ts';
import { formatTicketRefreshCountdown } from './ticket-time.ts';
import { useTicketPolling } from './use-ticket-polling.ts';

/** 左栏刷新状态与交互；刷新返回后端快照，不等待 CLI。 */
export type TicketListHeaderProps = {
  snapshot: TicketListSnapshot | null;
  isRequesting: boolean;
  isDingtalkReady: boolean;
  getNow?: () => number;
  clock?: PollingClock;
  contentId: string;
  onToggle: () => void;
  onRefresh: () => Promise<void>;
};

function getReadSummary(snapshot: TicketListSnapshot | null, refreshLabel: string | null): string {
  if (!snapshot || snapshot.kind === 'loading') return refreshLabel ?? '';
  let succeeded = 0;
  let failed = 0;
  for (const { verification, failures } of snapshot.items) {
    if (verification === 'failed' || failures?.length) failed++;
    else if (verification === 'ready') succeeded++;
  }
  const parts = [TICKET_COPY.formatReadSuccessCount(succeeded)];
  if (failed) parts.push(TICKET_COPY.formatReadFailureCount(failed));
  if (refreshLabel) parts.push(refreshLabel);
  if (
    snapshot.listRefreshState ||
    snapshot.sources.some(({ kind }) => kind !== 'success') ||
    snapshot.kind === 'failure'
  )
    parts.push(TICKET_COPY.listPartlyUnread);
  return parts.join(TICKET_COPY.countSeparator);
}

/**
 * 1. 按连接和计划计时。2. 紧凑显示后台进度及实际读取成绩。
 * @param props 当前快照、连接状态、可替换的本机时钟和刷新入口。
 * @returns 紧凑的列表标题、刷新状态和读取结果。
 * @throws 无预期错误。
 */
export function TicketListHeader({
  snapshot,
  isRequesting,
  isDingtalkReady,
  getNow = Date.now,
  clock,
  contentId,
  onToggle,
  onRefresh,
}: TicketListHeaderProps): ReactElement {
  // 1. 从后台的实际计划计算，浏览器休眠时不会把计时器触发次数算作经过时间。
  const isRefreshing = isDingtalkReady && snapshot?.isRefreshing === true;
  const next = isDingtalkReady && !isRefreshing ? (snapshot?.nextRefreshAt ?? null) : null;
  const [now, setNow] = useState(getNow);
  const updateNow = useCallback(() => setNow(getNow()), [getNow]);
  useEffect(updateNow, [next, updateNow]);
  useTicketPolling({
    reload: updateNow,
    intervalMs: TICKET_COUNTDOWN_INTERVAL_MS,
    isEnabled: next !== null,
    clock,
  });
  const refreshLabel = isRefreshing
    ? TICKET_COPY.refreshingBackground
    : formatTicketRefreshCountdown({ time: next, now });
  // 2. 部分详情计入失败；待预读的条目只计入进度。
  const readSummary = getReadSummary(snapshot, refreshLabel);
  return (
    <div className="ticket-list-heading">
      <div className="ticket-list-heading-row">
        <h1>{TICKET_COPY.title}</h1>
        <Button
          size="small"
          disabled={isRequesting || snapshot?.isRefreshing}
          onClick={() => void onRefresh()}
        >
          {TICKET_COPY.refresh}
        </Button>
        <Button
          className="ticket-list-collapse"
          size="small"
          variant="quiet"
          aria-label={TICKET_COPY.collapseList}
          title={TICKET_COPY.collapseList}
          aria-expanded="true"
          aria-controls={contentId}
          onClick={onToggle}
        >
          <span aria-hidden="true" />
        </Button>
      </div>
      {readSummary && <p className="ticket-progress">{readSummary}</p>}
    </div>
  );
}
