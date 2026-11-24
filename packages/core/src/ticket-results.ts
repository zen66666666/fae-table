// 为后台和网页提供一致的单据失败结果，避免异常被转换为空列表成功。
import type {
  TicketDetailResult,
  TicketListResult,
  TicketReason,
  TicketSourceResult,
  TicketListSnapshot,
  TicketDetailSnapshot,
} from './ticket-types.ts';

/**
 * 创建没有可用单据的明确失败结果。
 * @param reason 安全原因类别，不接受原始错误正文。
 * @param sources 可选的各来源读取进度，默认没有已完成来源。
 * @returns kind 为 failure 的列表，调用方不可按空成功显示。
 * @throws 无。
 */
export function createTicketListFailure(
  reason: TicketReason,
  sources: TicketSourceResult[] = [],
): TicketListResult {
  return { kind: 'failure', reason, items: [], sources };
}

/**
 * 创建没有可用详情的明确失败结果。
 * @param reason 安全原因类别，不接受原始错误正文。
 * @returns kind 为 failure、detail 为 null 的详情结果。
 * @throws 无。
 */
export function createTicketDetailFailure(reason: TicketReason): TicketDetailResult {
  return { kind: 'failure', reason, detail: null };
}

/**
 * 创建尚未取得列表结果的快照，供后台初始状态与网页加载状态复用。
 * @returns 没有单据内容的 loading 快照，不代表空列表读取成功。
 * @throws 无。
 */
export function createInitialTicketSnapshot(): TicketListSnapshot {
  return {
    kind: 'loading',
    reason: 'none',
    items: [],
    sources: [],
    updatedAt: null,
    isRefreshing: false,
    nextRefreshAt: null,
    prefetch: { completed: 0, total: 0 },
  };
}

/**
 * 创建没有可用列表的失败快照。
 * @param reason 安全错误类别。
 * @returns 带默认时间与进度的失败快照，不包含原始异常。
 * @throws 无。
 */
export function createTicketListSnapshotFailure(reason: TicketReason): TicketListSnapshot {
  return { ...createInitialTicketSnapshot(), kind: 'failure', reason };
}

/**
 * 创建没有可用详情和读取时间的失败响应。
 * @param reason 安全错误类别。
 * @returns 详情为 null、读取时间为 null 的明确失败结果。
 * @throws 无。
 */
export function createTicketDetailSnapshotFailure(reason: TicketReason): TicketDetailSnapshot {
  return { ...createTicketDetailFailure(reason), readAt: null };
}
