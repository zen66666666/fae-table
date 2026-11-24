// 根据两个来源合并后的处理记录和评论判断跟进进度，供单据详情投影使用。
import { isTicketFinished } from '../../core/src/index.ts';
import type { JsonObject, TicketSummary } from '../../core/src/index.ts';
import { hasDetailOwnedRunningTask } from './approval-task-evidence.ts';
import { isNormalApprovalAgreement } from './approval-write-evidence.ts';
import {
  hasCompleteTicketRecords,
  readTicketApprovalOperation,
} from './ticket-approval-records.ts';
import { RECEIPT_STEP_NAME, SOLUTION_STEP_NAME } from './ticket-progress-steps.ts';
import { readTicketRecordTime } from './ticket-record-cleanup.ts';
import { isTicketCommentAction } from './ticket-records.ts';
import { readTicketText } from './ticket-values.ts';

type TicketReplyProgress = Required<
  Pick<TicketSummary, 'hasReplied' | 'hasConfirmedReceipt' | 'isAwaitingOthers'>
>;

const UNCONFIRMED_PROGRESS: TicketReplyProgress = {
  hasReplied: false,
  hasConfirmedReceipt: false,
  isAwaitingOthers: false,
};

function readLatestCommentTimes(
  records: readonly JsonObject[],
  userId: string,
): { latestMine: number; latestOther: number } | null {
  let latestMine = -Infinity;
  let latestOther = -Infinity;
  for (const record of records) {
    // 审批动作的意见可能是同意理由，只有已知的评论动作才算回复。
    const action = readTicketText(record.operationType);
    if (action === null || !isTicketCommentAction(action)) continue;
    const actor = readTicketText(record.userId);
    const timestamp = readTicketRecordTime(record);
    if (actor === null || !Number.isFinite(timestamp)) return null;
    if (actor === userId) latestMine = Math.max(latestMine, timestamp);
    else latestOther = Math.max(latestOther, timestamp);
  }
  return { latestMine, latestOther };
}

function isCurrentAgreement(time: number, reset: number): boolean {
  // 同意与退回或重新提交同一毫秒时无法确认先后，不能据此确认进度。
  return Number.isFinite(time) && time > reset;
}

function readCurrentApprovalTimes(
  records: readonly JsonObject[],
  userId: string,
): { receiptTime: number | null; solutionTime: number | null } {
  let latestReceipt = -Infinity;
  let latestSolution = -Infinity;
  let latestReset = -Infinity;
  for (const row of records) {
    const record = readTicketApprovalOperation(row);
    if (!record) continue;
    // 关键动作缺时间时不能排序，保守地将相应证据记为不可用。
    const { time, step } = record;
    if (record.isReset) {
      latestReset = Math.max(latestReset, time);
      continue;
    }
    if (!isNormalApprovalAgreement(record)) continue;
    if (step?.includes(RECEIPT_STEP_NAME)) latestReceipt = Math.max(latestReceipt, time);
    if (step?.includes(SOLUTION_STEP_NAME) && row.userId === userId)
      latestSolution = Math.max(latestSolution, time);
  }
  return {
    receiptTime: isCurrentAgreement(latestReceipt, latestReset) ? latestReceipt : null,
    solutionTime: isCurrentAgreement(latestSolution, latestReset) ? latestSolution : null,
  };
}

/**
 * 1. 核实记录完整性。2. 根据有效同意和最新评论投影当前单据的回复进度。
 * @param options 详情、独立记录接口结果、合并后的记录、流程状态和已核实的当前用户标识。
 * @returns 供单据分组使用的布尔值，不包含原始内容或人员标识。
 * @throws 无；不根据姓名、数组顺序或缺失时间猜测记录先后。
 */
export function readTicketReplyProgress(options: {
  detail: JsonObject;
  supplemental: JsonObject | null;
  records: readonly JsonObject[];
  status: TicketSummary['status'];
  userId: string;
}): TicketReplyProgress {
  const { detail, supplemental, records, status, userId } = options;
  // 1. 两套记录都读全才能判定当前进度，避免漏掉新退回或新评论。
  if (!hasCompleteTicketRecords(detail) || !hasCompleteTicketRecords(supplemental))
    return UNCONFIRMED_PROGRESS;

  // 2. 两人的最新评论时间相同时无法确定先后，按未回复处理。
  const comments = readLatestCommentTimes(records, userId);
  const { receiptTime, solutionTime } = readCurrentApprovalTimes(records, userId);
  return {
    hasReplied: comments !== null && comments.latestMine > comments.latestOther,
    hasConfirmedReceipt: receiptTime !== null,
    isAwaitingOthers:
      solutionTime !== null &&
      !isTicketFinished({ status }) &&
      comments !== null &&
      comments.latestOther < solutionTime &&
      hasDetailOwnedRunningTask({ detail, userId }) === false,
  };
}
