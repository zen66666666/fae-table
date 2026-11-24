// 发布一轮列表并编排预读，供单据服务在本轮账号校验范围内调用。
import { createTicketListFailure } from '../../../packages/core/src/index.ts';
import type {
  TicketDetailSnapshot,
  TicketListItem,
  TicketListResult,
  TicketSummary,
} from '../../../packages/core/src/index.ts';
import type { TicketDetailCache } from './ticket-detail-cache.ts';
import { planTicketPrefetch, runTicketPrefetch, shouldRetryTicketRead } from './ticket-prefetch.ts';
import type { TicketPrefetchPlan } from './ticket-prefetch.ts';
import type { TicketSnapshotStore } from './ticket-snapshot-store.ts';

type TicketRefreshCycleOptions = {
  snapshots: TicketSnapshotStore;
  details: TicketDetailCache;
  now: () => number;
  isCurrent: () => boolean;
  listTickets: () => Promise<TicketListResult>;
  readDetail: (options: {
    ticket: TicketSummary;
    isRetry: boolean;
  }) => Promise<TicketDetailSnapshot>;
  onRecentTickets: (items: readonly TicketListItem[]) => void;
  onPrefetchComplete: (items: readonly TicketListItem[]) => void;
};

function preparePrefetch(options: {
  cycle: TicketRefreshCycleOptions;
  result: TicketListResult;
  readAt: number;
}): TicketPrefetchPlan {
  // 1. 仅完整列表可删除详情范围。2. 先发布列表，完整成功后才允许判定历史是否过期。
  const { cycle, result, readAt } = options;
  const { snapshots, details, onRecentTickets } = cycle;
  const prepared = snapshots.prepareList(result);
  details.setTickets(prepared.listed, result.kind === 'success'); // 1.
  const plan = planTicketPrefetch({
    tickets: prepared.fresh,
    previous: snapshots.items,
    carried: prepared.carried,
    shouldPreferListSummary: result.kind === 'partial',
    peek: (id) => details.peek(id),
  });
  snapshots.publishList({ result, prepared, plan, readAt }); // 2.
  // 部分来源读取失败时缺失的单据可能仍在列表中，不能据此清理。
  if (result.kind === 'success') onRecentTickets(snapshots.items);
  return plan;
}

function readPrefetchDetail(options: {
  cycle: TicketRefreshCycleOptions;
  ticket: TicketSummary;
  isRetry: boolean;
  previous?: TicketDetailSnapshot;
}): Promise<TicketDetailSnapshot> {
  const { cycle, ticket, isRetry, previous } = options;
  const cached = cycle.details.peek(ticket.id);
  // 有效的终态缓存已在建计划时结算；这里仅复用本轮开始后完成的完整详情。
  if (cached?.kind === 'success' && cached !== previous) {
    return Promise.resolve(cached);
  }
  return cycle.readDetail({ ticket, isRetry });
}

/**
 * 1. 读取列表并核对账号。2. 发布列表和预读状态。3. 预读并通知完成。
 * @param cycle 当前账号的列表、详情读取和通知依赖。
 * @returns 需要按退避补读列表或详情时的失败时间，否则为 undefined。
 * @throws 由注入的快照、通知或预读依赖的意外异常决定。
 */
export async function runTicketRefreshCycle(
  cycle: TicketRefreshCycleOptions,
): Promise<number | undefined> {
  let result: TicketListResult;
  try {
    result = await cycle.listTickets(); // 1.
  } catch {
    result = createTicketListFailure('unknown');
  }
  if (!cycle.isCurrent()) return undefined;
  const readAt = cycle.now();
  const retryAt =
    shouldRetryTicketRead(result) || result.sources.some(shouldRetryTicketRead)
      ? readAt
      : undefined;
  if (result.kind === 'failure') {
    // 整体失败没有新的成员证据，不能改写详情范围或启动手册预读。
    cycle.snapshots.publishListFailure({ result, readAt }); // 2.
    return retryAt;
  }
  const plan = preparePrefetch({ cycle, result, readAt }); // 2.
  let hasRetryableDetailFailure = false;
  await runTicketPrefetch({
    active: plan.active,
    finished: plan.finished,
    isCurrent: cycle.isCurrent,
    read: ({ ticket, isRetry }) =>
      readPrefetchDetail({
        cycle,
        ticket,
        isRetry,
        previous: plan.previousDetails.get(ticket.id),
      }),
    onSettled: (detail) => {
      cycle.snapshots.settleDetail(detail.kind !== 'success');
      hasRetryableDetailFailure ||= shouldRetryTicketRead(detail);
    },
  }); // 3.
  if (!cycle.isCurrent()) return undefined;
  cycle.onPrefetchComplete(cycle.snapshots.items);
  // 详情补读全部结算后才开始退避，避免慢读占满第一次等待时间。
  return retryAt ?? (hasRetryableDetailFailure ? cycle.now() : undefined);
}
