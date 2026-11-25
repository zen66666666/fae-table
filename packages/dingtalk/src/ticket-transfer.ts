// 核实审批单据的转入、转出与后续动态，供单据详情投影使用。
import { isObject, isTicketFinished } from '../../core/src/index.ts';
import type { JsonObject, TicketSource, TicketSummary } from '../../core/src/index.ts';
import { getDetailOwnedRunningTask, hasDetailOwnedRunningTask } from './approval-task-evidence.ts';
import { isApprovalAgreement, isApprovalRejection } from './approval-write-evidence.ts';
import { isCompleteDingtalkResult } from './common.ts';
import {
  getLatestTicketOperation,
  hasCompleteTicketRecords,
  isTicketTaskOperation,
  readTicketOperationEpoch,
  TICKET_REDIRECT_ACTION,
} from './ticket-approval-records.ts';
import type { TicketApprovalOperation } from './ticket-approval-records.ts';
import { isTicketRecordPlaceholder } from './ticket-record-cleanup.ts';
import { isTicketCommentAction } from './ticket-records.ts';
import { readTicketMemberName, readTicketText, readTicketTime } from './ticket-values.ts';

const REDIRECTED = 'REDIRECTED';
const CANCELED = 'CANCELED';
const RUNNING = 'RUNNING';
const NON_HANDLING_ACTIONS = new Set(['CC', 'PROCESS_CC', 'START', 'START_PROCESS_INSTANCE']);

type TicketTransferOut = Pick<
  TicketSummary,
  'isTransferredOut' | 'hasTransferOutActivity' | 'transferOutHandlerNames'
>;

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

function readTransferOutHandlerNames(options: {
  rows: unknown;
  names: ReadonlyMap<string, string>;
}): string[] | undefined {
  const { rows, names } = options;
  if (!Array.isArray(rows)) return;
  const handlers = new Map<string, string | null>();
  for (const task of rows) {
    if (!isObject(task) || task.taskStatus !== RUNNING) continue;
    const userId = readTicketText(task.userId);
    if (userId === null || handlers.get(userId)) continue;
    const name = readTicketMemberName({ name: task.userName, userId, names });
    handlers.set(userId, name?.trim() === userId ? null : name);
  }
  const resolved = [...handlers.values()];
  // 缺少姓名时隐藏整项，以免把成员编号或不完整的处理人数带到页面。
  if (resolved.length && resolved.every((name) => name !== null)) return resolved;
}

function isTransferOutActivity(record: TicketApprovalOperation): boolean {
  return (
    record.type === TICKET_REDIRECT_ACTION ||
    isTicketCommentAction(record.type) ||
    isApprovalAgreement(record) ||
    isApprovalRejection(record)
  );
}

/**
 * 核实本轮流程中从本人转出的单据，并提取后续动态和处理人姓名。
 * @param options 摘要、完整详情及记录、已核实身份和可选姓名的查询结果。
 * @returns 确定转出时返回对应标记和可展示的姓名，证据不足时返回空对象。
 * @throws 无预期错误。
 */
export function readTicketTransferOut(options: {
  summary: TicketSummary;
  detail: JsonObject;
  supplemental: JsonObject | null;
  records: readonly JsonObject[];
  userId: string;
  isTransferredToMe: boolean;
  names: ReadonlyMap<string, string>;
}): TicketTransferOut {
  // 1. 排除仍由本人负责或证据不全的单据。2. 核实本轮最后一次转出。3. 投影后续动态。
  const { summary, detail, supplemental, records, userId, isTransferredToMe, names } = options;
  if (
    isTicketFinished(summary) ||
    summary.sources.includes('pending') ||
    isTransferredToMe ||
    !hasCompleteTicketRecords(detail) ||
    !hasCompleteTicketRecords(supplemental) ||
    hasDetailOwnedRunningTask({ detail, userId }) !== false
  )
    return {}; // 1.

  const epoch = readTicketOperationEpoch(records); // 2.
  if (!epoch) return {};
  const redirects = epoch.operations.filter(({ type }) => type === TICKET_REDIRECT_ACTION);
  // 转交缺时间会改变先后顺序；同毫秒的其他动作也不能用接口数组顺序判断。
  if (redirects.some(({ time }) => !Number.isFinite(time))) return {};
  const latest = getLatestTicketOperation(
    redirects.filter(({ actor, time }) => actor === userId && time > epoch.lastReset),
  );
  if (
    !latest ||
    epoch.operations.some((row) => row !== latest && row.time === latest.time) ||
    // 更晚的匿名转交也可能是本人发起的，无法确认本次转出的时间。
    redirects.some(({ actor, time }) => actor === null && time > latest.time)
  ) {
    return {};
  }

  // 3. 退回会开始新一轮，上一轮的转出已在上面的时间起点检查中排除。
  const hasTransferOutActivity = epoch.operations.some(
    (row) =>
      Number.isFinite(row.time) &&
      row.time > latest.time &&
      row.actor !== null &&
      row.actor !== userId &&
      isTransferOutActivity(row),
  );
  const transferOutHandlerNames = readTransferOutHandlerNames({ rows: detail.tasks, names });
  return { isTransferredOut: true, hasTransferOutActivity, transferOutHandlerNames };
}
