// 定义单据写回的固定动作、路由和确认结果，供网页、后台和钉钉模块共用。
import { TICKET_DRAFT_MAX_LENGTH } from './ticket-types.ts';

/** 单据写回的接口路径段。 */
export const TICKET_WRITE_ROUTES = {
  resource: 'write',
  prepare: 'prepare',
  execute: 'execute',
} as const;

/** 写回意见或评论的最大字符数，与当前回复草稿使用同一上限。 */
export const TICKET_WRITE_TEXT_LIMIT = TICKET_DRAFT_MAX_LENGTH;

/** 本轮允许的固定业务动作。 */
export const TICKET_WRITE_ACTIONS = ['approve', 'reject', 'comment'] as const;

/** 用户明确选择的单据处理或评论动作。 */
export type TicketWriteAction = (typeof TICKET_WRITE_ACTIONS)[number];

/** 后台核实出的可用动作，仅供控制网页按钮。 */
export type TicketWriteAvailability = {
  actions: TicketWriteAction[];
  isBusy?: true;
  /** 单据详情仍在后台预读，审批动作暂不显示。 */
  isDetailLoading?: true;
  /** 待处理来源仍在，但已读详情没有恰好一个属于当前用户的进行中任务。 */
  reason?: 'no-owned-running-task';
};

/** 后台向网页确认的单据、预读时间与实际写入文字。 */
export type TicketWriteSummary = {
  ticketName: string;
  action: TicketWriteAction;
  text: string;
  detailReadAt: string | null;
};

/** 钉钉写入和执行门禁的固定结果，不包含 CLI 原文。 */
export type TicketWriteOutcome = {
  kind:
    | 'completed'
    | 'not-completed'
    | 'uncertain'
    | 'previous-completed'
    | 'previous-uncertain'
    | 'no-comment-permission'
    | 'not-allowed'
    | 'changed'
    | 'busy'
    | 'invalid-confirmation'
    | 'text-required';
  /** 预读状态不足以准备指定动作时的安全提示。 */
  reason?: 'detail-loading' | 'no-owned-running-task';
  /** 此码已用于另一条请求，网页须按结果不确定处理传输重放。 */
  isConfirmationUsed?: true;
};

/** 两步确认中准备阶段的安全结果。 */
export type TicketWritePreparation =
  | { kind: 'ready'; code: string; summary: TicketWriteSummary }
  | TicketWriteOutcome;

/**
 * 识别工作台允许写回的动作。
 * @param value 来自本机网页的未知字段。
 * @returns 动作在固定名单中时为 true。
 * @throws 无预期错误。
 */
export function isTicketWriteAction(value: unknown): value is TicketWriteAction {
  return TICKET_WRITE_ACTIONS.some((action) => action === value);
}

/**
 * 生成可作独立 CLI 参数的意见或评论，去掉控制字符并保持普通业务文字。
 * @param text 已核对长度的回复文字。
 * @returns 去除控制字符和首尾空白后的文本。
 * @throws 无预期错误。
 */
export function normalizeTicketWriteText(text: string): string {
  return text.replace(/\p{Cc}+/gu, ' ').trim();
}
