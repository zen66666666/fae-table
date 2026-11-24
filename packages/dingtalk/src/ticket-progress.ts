// 从已经读取的审批记录和任务核实当前步骤，单独投影为只读流程进度。
import { isTicketFinished } from '../../core/src/index.ts';
import type { JsonObject, TicketProgress, TicketSummary } from '../../core/src/index.ts';
import { getDetailOwnedRunningTask, hasDetailOwnedRunningTask } from './approval-task-evidence.ts';
import { isApprovalAgreement } from './approval-write-evidence.ts';
import {
  getLatestTicketOperation,
  hasCompleteTicketRecords,
  isTicketTaskOperation,
  readTicketApprovalOperation,
  TICKET_REDIRECT_ACTION,
} from './ticket-approval-records.ts';
import type { TicketApprovalOperation } from './ticket-approval-records.ts';
import { getTicketProgressStepIndex, getTicketProgressSteps } from './ticket-progress-steps.ts';
import { readTicketText } from './ticket-values.ts';

function readCurrentOperations(
  records: readonly JsonObject[],
): TicketApprovalOperation[] | undefined {
  let lastReset = -Infinity;
  const operations: TicketApprovalOperation[] = [];
  for (const row of records) {
    const record = readTicketApprovalOperation(row);
    if (!record) {
      // 空占位和纯附件行不是操作；有节点或任务证据却没有动作时不能补猜。
      if (readTicketText(row.activityId) || row.taskId != null) return;
      continue;
    }
    if (!record.isReset && !isTicketTaskOperation(record.type)) continue;
    if (!Number.isFinite(record.time)) return;
    if (record.isReset) lastReset = Math.max(lastReset, record.time);
    else operations.push(record);
  }
  // 退回与处理同一毫秒时无法确认先后，不能把旧的审批沿用到本轮。
  if (operations.some(({ time }) => time === lastReset)) return;
  return operations.filter(({ time }) => time > lastReset);
}

function getFirstUnapprovedIndex(options: {
  records: readonly TicketApprovalOperation[];
  steps: TicketProgress['steps'];
}): number | undefined {
  const { records, steps } = options;
  const approved = new Set<number>();
  for (const record of records) {
    if (!isApprovalAgreement(record)) continue;
    const index = getTicketProgressStepIndex({ name: record.step, steps });
    if (index < 0) return;
    approved.add(index);
  }
  let next = 0;
  while (approved.has(next)) next++;
  // 已知同意必须从第一步连续，全部通过而列表仍未结束时也不能推测新节点。
  return next === approved.size && next < steps.length ? next : undefined;
}

function hasUnclearLatestTransfer(records: readonly TicketApprovalOperation[]): boolean {
  const latestTime = records.reduce((latest, record) => Math.max(latest, record.time), -Infinity);
  return records.some(
    (record) => record.time === latestTime && record.type === TICKET_REDIRECT_ACTION,
  );
}

/**
 * 1. 核实模板、记录与任务。2. 从最近退回或提交后找连续同意。3. 核实是否转交给我。
 * @param options 当前摘要、已经合并的记录、原始详情和已核实用户。
 * @returns 白名单步骤和当前状态；无法确认时为 undefined。
 * @throws 无预期错误；从不发起请求，也不投影原始节点或人员标识。
 */
export function readTicketProgress(options: {
  summary: Pick<TicketSummary, 'templateName' | 'status'>;
  detail: JsonObject;
  supplemental: JsonObject | null;
  records: readonly JsonObject[];
  userId: string;
}): TicketProgress | undefined {
  const { summary, detail, supplemental, records, userId } = options;
  const steps = getTicketProgressSteps(summary.templateName); // 1.
  if (
    !steps ||
    isTicketFinished(summary) ||
    !hasCompleteTicketRecords(detail) ||
    !hasCompleteTicketRecords(supplemental)
  )
    return;
  const hasOwnedTask = hasDetailOwnedRunningTask({ detail, userId });
  if (hasOwnedTask === null) return;
  const currentOperations = readCurrentOperations(records); // 2.
  if (!currentOperations) return;
  const currentIndex = getFirstUnapprovedIndex({ records: currentOperations, steps });
  if (currentIndex === undefined) return;

  const latest = getLatestTicketOperation(currentOperations); // 3.
  // 同一毫秒的同意记录仍能证明节点完成；涉及转交时不能猜哪条动作最后发生。
  if (!latest && hasUnclearLatestTransfer(currentOperations)) return;
  if (latest?.type === TICKET_REDIRECT_ACTION) {
    const redirectIndex = getTicketProgressStepIndex({ name: latest.step, steps });
    if (redirectIndex < 0 || latest.actor === null) return;
    if (
      latest.actor !== userId &&
      hasOwnedTask &&
      getDetailOwnedRunningTask({ detail, userId, isSingleRunningTaskRequired: true })
    )
      return { steps, currentIndex: redirectIndex, state: 'transferred-to-me' };
  }
  return { steps, currentIndex, state: hasOwnedTask ? 'waiting-for-me' : 'waiting-for-others' };
}
