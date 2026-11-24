// 从预读详情生成只供后台使用的审批操作提示。
import type { TicketDetail, TicketListItem } from '../../../packages/core/src/index.ts';
import { getTicketOwnedRunningTask } from '../../../packages/dingtalk/src/index.ts';
import { hasPendingApprovalSource } from './ticket-write-access.ts';

/** 当前预读状态；任务编号只供后台创建确认，不返回网页。 */
export type TicketApprovalPreview =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; taskId: string };

/**
 * 读取缓存里的本人进行中任务，供写回服务确定当前可用的审批。
 * @param options 当前列表项、预读详情及预读是否已失败。
 * @returns 待预读、不可用或已核实的任务状态。
 * @throws 无预期错误。
 */
export function getTicketApprovalPreview(options: {
  ticket: TicketListItem | undefined;
  detail: TicketDetail | null | undefined;
  hasFailedDetail: boolean;
}): TicketApprovalPreview {
  const { ticket, detail, hasFailedDetail } = options;
  if (!detail) return { kind: hasFailedDetail ? 'unavailable' : 'loading' };
  const taskId = hasPendingApprovalSource(ticket) ? getTicketOwnedRunningTask(detail) : null;
  return taskId ? { kind: 'ready', taskId } : { kind: 'unavailable' };
}
