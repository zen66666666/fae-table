// 从审批详情核实已处理或仍待本人处理的转交，供单据详情投影使用。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject, TicketSource } from '../../core/src/index.ts';
import { getDetailOwnedRunningTask } from './approval-task-evidence.ts';
import { isCompleteDingtalkResult } from './common.ts';
import {
  getLatestTicketOperation,
  isTicketTaskOperation,
  TICKET_REDIRECT_ACTION,
} from './ticket-approval-records.ts';
import { isTicketRecordPlaceholder } from './ticket-record-cleanup.ts';
import { isTicketCommentAction } from './ticket-records.ts';
import { readTicketText, readTicketTime } from './ticket-values.ts';

const REDIRECTED = 'REDIRECTED';
const CANCELED = 'CANCELED';
const NON_HANDLING_ACTIONS = new Set(['CC', 'PROCESS_CC', 'START', 'START_PROCESS_INSTANCE']);

type TransferRecord = {
  action: string | null;
  activityId: string | null;
  actor: string | null;
  time: number;
};

function readTransferRecord(row: JsonObject): TransferRecord {
  // 详情给出整数毫秒；把任意字符串交给 Date.parse 可能将无效时间猜成日期。
  const date = typeof row.date === 'number' && Number.isSafeInteger(row.date) ? row.date : null;
  return {
    action: readTicketText(row.type)?.toUpperCase() ?? null,
    activityId: readTicketText(row.activityId),
    actor: readTicketText(row.userId),
    time: Date.parse(readTicketTime(date) ?? ''),
  };
}

function canBeTaskAction(record: TransferRecord): boolean {
  const { action } = record;
  return action === null || (!isTicketCommentAction(action) && !NON_HANDLING_ACTIONS.has(action));
}

function getNextActor(options: {
  redirect: TransferRecord;
  records: readonly TransferRecord[];
}): string | null {
  const { redirect, records } = options;
  let next: TransferRecord | null = null;
  let ambiguousAt = Infinity;
  for (const record of records) {
    if (record === redirect || (record.activityId && record.activityId !== redirect.activityId))
      continue;
    // 节点或动作缺失、时间相同或未知时，不能跳过可能更早的处理记录来推断接收人。
    if (!Number.isFinite(record.time)) return null;
    if (record.time < redirect.time) continue;
    if (
      record.time === redirect.time ||
      !record.activityId ||
      !record.action ||
      !isTicketTaskOperation(record.action)
    ) {
      ambiguousAt = Math.min(ambiguousAt, record.time);
    } else if (!next || record.time < next.time) {
      next = record;
    } else if (record.time === next.time) {
      ambiguousAt = Math.min(ambiguousAt, record.time);
    }
  }
  return next && next.time < ambiguousAt ? next.actor : null;
}

function readRedirectActors(tasks: unknown[]): Set<string> {
  const actors = new Set<string>();
  for (const row of tasks) {
    if (!isObject(row) || row.taskStatus !== CANCELED || row.taskResult !== REDIRECTED) continue;
    const actor = readTicketText(row.userId);
    if (actor) actors.add(actor);
  }
  return actors;
}

function isOtherUserRedirect(options: {
  record: TransferRecord;
  userId: string;
  redirectActors: ReadonlySet<string>;
}): boolean {
  const { record, userId, redirectActors } = options;
  return (
    record.action === TICKET_REDIRECT_ACTION &&
    record.actor !== null &&
    record.actor !== userId &&
    redirectActors.has(record.actor) &&
    record.activityId !== null &&
    Number.isFinite(record.time)
  );
}

/**
 * 核实转交的接收人是否为当前用户，供详情投影和工作台分组使用。
 * @param options 已读取的原始详情、已核实的当前用户标识和当前单据来源。
 * @returns 已确认本人处理过转交，或最新处理是转交且仅有本人的待处理任务时为 true。
 * @throws 无预期错误。
 */
export function isTicketTransferredToCurrentUser(options: {
  detail: JsonObject;
  userId: string;
  sources: readonly TicketSource[];
}): boolean {
  // 1. 检查详情与发起人的取消任务。2. 核实已处理的转交。3. 核实待处理的转交。
  const { detail, userId, sources } = options;
  const { operationRecords, tasks } = detail;
  // 1. 独立记录接口缺少节点标识，不能用于判断转交接收人。
  if (
    !isCompleteDingtalkResult(detail) ||
    !Array.isArray(operationRecords) ||
    !operationRecords.every(isObject) ||
    !Array.isArray(tasks)
  )
    return false;
  const redirectActors = readRedirectActors(tasks);
  if (redirectActors.size === 0) return false;

  // 2. 空占位、附件容器和评论没有处理动作，不能用于推断接收人。
  const records = operationRecords
    .filter((record) => !isTicketRecordPlaceholder(record))
    .map(readTransferRecord)
    .filter(canBeTaskAction);
  const isHandled = records.some(
    (record) =>
      isOtherUserRedirect({ record, userId, redirectActors }) &&
      getNextActor({ redirect: record, records }) === userId,
  );
  if (isHandled) return true;

  // 3. 只有全单最新处理是别人转交、来源是待处理且只有一个运行任务时，才能判断待处理接收人。
  if (!sources.includes('pending')) return false;
  const latest = getLatestTicketOperation(records);
  return (
    latest !== null &&
    isOtherUserRedirect({ record: latest, userId, redirectActors }) &&
    getDetailOwnedRunningTask({ detail, userId, isSingleRunningTaskRequired: true }) !== null
  );
}
