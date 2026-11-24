// 集中定义单据写回按钮、确认和结果文案，供中栏回复区使用。
import type { TicketWriteAction, TicketWriteOutcome } from '../../../packages/core/src/index.ts';

/** 中栏可执行动作的固定显示名。 */
export const TICKET_WRITE_ACTION_LABELS: Record<TicketWriteAction, string> = {
  approve: '同意',
  reject: '拒绝',
  comment: '提交评论',
};

/** 确认表单和请求状态的固定文字。 */
export const TICKET_WRITE_COPY = {
  approveHeading: '确认同意这张单据',
  rejectHeading: '确认拒绝这张单据',
  warning: '将直接写入钉钉，无法在工作台撤回',
  approveOpinion: '意见（可选）',
  rejectOpinion: '意见（必填）',
  decisionPrompt: '当前节点在等你',
  formatDecisionStep: (step: string, isTransferred: boolean): string =>
    `等你：${step}${isTransferred ? '（转交）' : ''}`,
  formatNextStep: (step: string): string => `同意后进入：${step}`,
  cancel: '取消',
  confirm: '确认',
  executing: '正在核对并写入钉钉…',
  loadingTicket: '正在读取单据…',
  actionsFailed: '可用操作读取失败',
  noOwnedRunningTask: '未找到属于你的进行中任务',
  retryActions: '重新读取',
  checkingFailed: '未能核对提交内容，请重试。',
  textTooLong: '提交内容太长，请缩短后重新核对。',
  commentSending: '发送中…',
  commentSent: '已发送',
  commentFailed: '未发送',
  commentUncertain: '未确认是否发出，请到钉钉核对',
  commentJustNow: '刚刚',
  readMinutesAgo: ' 分钟前读取',
  readTimeMissing: '读取时间未知',
  refreshTicket: '更新',
  refreshingTicket: '更新中…',
} as const;

/** 提交和重新核对的安全结果，不显示钉钉的原始回复。 */
export const TICKET_WRITE_OUTCOME_LABELS: Record<TicketWriteOutcome['kind'], string> = {
  completed: '已完成',
  'previous-completed': '上次操作已完成，本次没有发送',
  'previous-uncertain': '上次操作结果不确定，请到钉钉核对。本次没有发送',
  'not-completed': '未完成，可以重新操作',
  uncertain: '结果不确定，请到钉钉核对',
  'no-comment-permission': '没有评论权限',
  'not-allowed': '当前单据不可执行此操作',
  changed: '流程已变化，请刷新后再操作',
  busy: '单据正在处理，请稍后重试',
  'invalid-confirmation': '确认已失效，请重新核对提交内容',
  'text-required': '请填写要提交的内容',
};

const TICKET_WRITE_REASON_LABELS: Record<NonNullable<TicketWriteOutcome['reason']>, string> = {
  'detail-loading': '单据还在读取，请稍后再操作',
  'no-owned-running-task': TICKET_WRITE_COPY.noOwnedRunningTask,
};

/**
 * 返回写入结论；重放请求明确被拒绝时，原请求的结果仍可能未收到。
 * @param outcome 后台写入或确认门禁的安全结果。
 * @returns 可直接显示的固定中文提示。
 * @throws 无预期错误。
 */
export function getTicketWriteOutcomeLabel(outcome: TicketWriteOutcome): string {
  if (outcome.isConfirmationUsed) return TICKET_WRITE_OUTCOME_LABELS.uncertain;
  return (
    (outcome.reason ? TICKET_WRITE_REASON_LABELS[outcome.reason] : undefined) ??
    TICKET_WRITE_OUTCOME_LABELS[outcome.kind]
  );
}
