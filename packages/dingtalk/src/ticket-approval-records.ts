// 读取审批记录中的动作、时间和退回信号，供回复分组、移交与流程步骤判断共用。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { isApprovalRevertAction, isApprovalTaskAction } from './approval-write-evidence.ts';
import { isCompleteDingtalkResult } from './common.ts';
import { readTicketRecordTime } from './ticket-record-cleanup.ts';
import { readTicketText } from './ticket-values.ts';

const SUBMISSION_ACTIONS = new Set([
  'START',
  'START_PROCESS_INSTANCE',
  'RESUBMIT',
  'RESUBMIT_PROCESS_INSTANCE',
]);

/** 详情记录中明确的任务转交动作。 */
export const TICKET_REDIRECT_ACTION = 'REDIRECT_TASK';

/** 钉钉模块内的审批记录证据，原始节点和人员信息不会投影。 */
export type TicketApprovalOperation = {
  type: string;
  result: string | null;
  time: number;
  step: string | null;
  actor: string | null;
  isReset: boolean;
};

/**
 * 核实记录接口没有明确的缺页、截断及无效记录项。
 * @param payload 详情或处理记录结果，读取失败时为 null。
 * @returns 记录集合有效且未报告不完整时为 true。
 * @throws 无预期错误。
 */
export function hasCompleteTicketRecords(payload: JsonObject | null): boolean {
  return (
    payload !== null &&
    isCompleteDingtalkResult(payload) &&
    Array.isArray(payload.operationRecords) &&
    payload.operationRecords.every(isObject)
  );
}

/**
 * 读取归并处理记录的动作、节点名称与最近一次提交或退回所需的时间。
 * @param row 已归一化并留在后台的记录对象。
 * @returns 审批判断证据；无明确动作时返回 null。
 * @throws 无预期错误。
 */
export function readTicketApprovalOperation(row: JsonObject): TicketApprovalOperation | null {
  const type = readTicketText(row.operationType)?.toUpperCase();
  if (!type) return null;
  const result = readTicketText(row.operationResult)?.toUpperCase() ?? null;
  const isReset =
    SUBMISSION_ACTIONS.has(type) ||
    isApprovalRevertAction({
      type,
      result,
      activityId: readTicketText(row.activityId),
      targetActivityId: readTicketText(row.targetActivityId),
      revertAction: readTicketText(row.revertAction),
    });
  return {
    type,
    result,
    isReset,
    time: readTicketRecordTime(row),
    step: readTicketText(row.showName),
    actor: readTicketText(row.userId),
  };
}

/**
 * 识别有固定枚举证据的任务处理动作。
 * @param type 钉钉处理记录的大写动作代码。
 * @returns 同意、拒绝、退回或转交等已有明确含义的动作返回 true。
 * @throws 无预期错误。
 */
export function isTicketTaskOperation(type: string): boolean {
  return type === TICKET_REDIRECT_ACTION || isApprovalTaskAction(type);
}

/**
 * 从一组动作中找严格晚于所有其他记录的一条。
 * @param records 带毫秒时间的候选记录；不依赖接口数组顺序。
 * @returns 唯一最新的动作；不存在、缺时间或并列时为 null。
 * @throws 无预期错误。
 */
export function getLatestTicketOperation<Record extends { time: number }>(
  records: readonly Record[],
): Record | null {
  let latest: Record | null = null;
  let isUnique = true;
  for (const record of records) {
    // 缺失时间可能使另一条动作更晚，不能依据原始数组位置猜测。
    if (!Number.isFinite(record.time)) return null;
    if (!latest || record.time > latest.time) {
      latest = record;
      isUnique = true;
    } else if (record.time === latest.time) {
      isUnique = false;
    }
  }
  return isUnique ? latest : null;
}
