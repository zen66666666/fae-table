// 定义工作台的纯排序规则，供后台生成快照及前端分组展示复用，不读取外部环境。
import type {
  TicketGroup,
  TicketListItem,
  TicketReplyStatus,
  TicketSummary,
} from './ticket-types.ts';

/** 左栏五组的固定展示顺序。 */
export const TICKET_GROUP_ORDER: readonly TicketGroup[] = [
  'pending',
  'transferred',
  'unreplied',
  'replied',
  'finished',
];
// 钉钉审批实例的终态；未知或缺失状态不能猜测为已结束。
const FINISHED_STATUSES = new Set(['COMPLETED', 'TERMINATED']);
const REPLY_STATUS_ORDER: readonly TicketReplyStatus[] = [
  'awaiting-receipt',
  'unreplied',
  'replied',
  'awaiting-others',
];

/**
 * 判断流程是否处于明确的结束状态。
 * @param ticket 单据的实际状态字段。
 * @returns 明确为完成或终止时返回 true；未知状态返回 false。
 * @throws 无。
 */
export function isTicketFinished(ticket: Pick<TicketSummary, 'status'>): boolean {
  return ticket.status !== null && FINISHED_STATUSES.has(ticket.status.toUpperCase());
}

/**
 * 从来源、关键步骤和评论生成列表的状态标签。
 * @param ticket 来源、流程状态与已核实的移交、回复标记。
 * @returns 待确认收到、未回复、已回复或待他人通过。
 * @throws 无。
 */
export function getTicketReplyStatus(ticket: TicketSummary): TicketReplyStatus {
  if (!isTicketFinished(ticket)) {
    if (ticket.sources.includes('pending') && ticket.hasConfirmedReceipt !== true)
      return 'awaiting-receipt';
    if (ticket.isAwaitingOthers === true) return 'awaiting-others';
  }
  return ticket.hasReplied === true ? 'replied' : 'unreplied';
}

/**
 * 按终态、移交及回复进度分类，展示分组不承担审批写入授权。
 * @param ticket 最新可用的安全单据摘要。
 * @param replyStatus 可选的已计算状态，用于同时生成分组与状态标签。
 * @returns 左栏五组之一。
 * @throws 无。
 */
export function getTicketGroup(
  ticket: TicketSummary,
  replyStatus = getTicketReplyStatus(ticket),
): TicketGroup {
  // 1. 结束流程收归历史。2. 已核实移交的单据始终单列。3. 其余按进度分类。
  if (isTicketFinished(ticket)) return 'finished'; // 1.
  if (ticket.isTransferredToMe === true) return 'transferred'; // 2.
  // 3. 已确认收到的待处理单据仍可审批，左栏按回复进度展示。
  if (replyStatus === 'awaiting-receipt') return 'pending';
  return replyStatus === 'unreplied' ? 'unreplied' : 'replied';
}

function readCreationTime(value: string | null): number {
  const timestamp = value === null ? NaN : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

/**
 * 根据业务分组和等待时长生成新数组，不修改输入单据。
 * @param items 带详情核实进度的单据集合。
 * @returns 按分组、适用的状态和发起时间排序的列表，时间缺失排最后。
 * @throws 无。
 */
export function sortTickets(items: readonly TicketListItem[]): TicketListItem[] {
  // 1. 同时更新状态与分组。2. 依次比较分组、组内状态和发起时间。
  return items
    .map((item) => {
      const replyStatus = getTicketReplyStatus(item); // 1.
      return { ...item, group: getTicketGroup(item, replyStatus), replyStatus };
    })
    .sort((left, right) => {
      // 2. 只在移交和已回复分组优先比较状态，其余分组保持原等待时长规则。
      const groupOrder =
        TICKET_GROUP_ORDER.indexOf(left.group) - TICKET_GROUP_ORDER.indexOf(right.group);
      if (groupOrder !== 0) return groupOrder;
      if (left.group === 'transferred' || left.group === 'replied') {
        const statusOrder =
          REPLY_STATUS_ORDER.indexOf(left.replyStatus) -
          REPLY_STATUS_ORDER.indexOf(right.replyStatus);
        if (statusOrder !== 0) return statusOrder;
      }
      // 等待越久越靠前；两个时间都缺失时返回 0，让稳定排序保留原顺序。
      const leftTime = readCreationTime(left.createdAt);
      const rightTime = readCreationTime(right.createdAt);
      return leftTime === rightTime ? 0 : leftTime - rightTime;
    });
}
