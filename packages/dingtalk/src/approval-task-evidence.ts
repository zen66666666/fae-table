// 识别详情中的本人任务并交叉核实写入后的状态，供预读和写回使用。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { readApprovalTaskId } from './approval-write-policy.ts';
import { isCompleteDingtalkResult } from './common.ts';
import { readTicketText } from './ticket-values.ts';

const RUNNING = 'RUNNING';
const ENDED = new Set(['COMPLETED', 'CANCELED']);

/** 详情中的本人在办任务，以及与独立清单交叉核实的任务。 */
export type ApprovalTaskEvidence = {
  taskId: string | null;
  endedTaskIds: ReadonlySet<string>;
  detailOwnedRunningTaskIds: ReadonlySet<string>;
};

type TaskDetails = ApprovalTaskEvidence & { runningCount: number };

function readListedTaskIds(id: string, payload: JsonObject | null): Set<string> | null {
  if (
    !payload ||
    !isCompleteDingtalkResult(payload) ||
    (payload.processInstanceId !== undefined && payload.processInstanceId !== id)
  )
    return null;
  const rows = payload.taskIdList;
  if (!Array.isArray(rows)) return null;
  const listed = new Set<string>();
  for (const row of rows) {
    if (!isObject(row) || (row.processInstanceId !== undefined && row.processInstanceId !== id))
      return null;
    const taskId = readApprovalTaskId(row.taskId);
    if (!taskId) return null;
    listed.add(taskId);
  }
  return listed;
}

function readTaskDetails(options: { rows: unknown; userId: string }): TaskDetails | null {
  const { rows, userId } = options;
  if (!Array.isArray(rows)) return null;
  const ids = new Set<string>();
  const detailOwnedRunningTaskIds = new Set<string>();
  const endedTaskIds = new Set<string>();
  let runningCount = 0;
  for (const row of rows) {
    if (!isObject(row)) return null;
    const taskId = readApprovalTaskId(row.taskId);
    const owner = readTicketText(row.userId);
    const status = readTicketText(row.taskStatus);
    // 重复或无法识别的任务不能证明当前用户只有一个进行中任务。
    if (
      !taskId ||
      ids.has(taskId) ||
      !owner ||
      !status ||
      (status !== RUNNING && !ENDED.has(status))
    )
      return null;
    ids.add(taskId);
    if (status === RUNNING) {
      runningCount += 1;
      if (owner === userId) detailOwnedRunningTaskIds.add(taskId);
    } else if (owner === userId) {
      endedTaskIds.add(taskId);
    }
  }
  const taskId =
    detailOwnedRunningTaskIds.size === 1
      ? (detailOwnedRunningTaskIds.values().next().value ?? null)
      : null;
  return { taskId, endedTaskIds, detailOwnedRunningTaskIds, runningCount };
}

function readCompleteTaskDetails(options: {
  detail: JsonObject;
  userId: string;
}): TaskDetails | null {
  const { detail, userId } = options;
  if (!isCompleteDingtalkResult(detail)) return null;
  return readTaskDetails({ rows: detail.tasks, userId });
}

/**
 * 核实已读的详情里是否还有本人进行中的任务，供回复状态判断使用。
 * @param options 当前详情和已核实的用户标识。
 * @returns 有至少一项时为 true，已核实均不是本人任务时为 false，证据不足时为 null。
 * @throws 无预期错误。
 */
export function hasDetailOwnedRunningTask(options: {
  detail: JsonObject;
  userId: string;
}): boolean | null {
  const tasks = readCompleteTaskDetails(options);
  return tasks ? tasks.detailOwnedRunningTaskIds.size > 0 : null;
}

/**
 * 从已读详情选出唯一属于本人的进行中任务，供预览操作和核实待处理转交使用。
 * @param options 已核实的详情、当前用户标识，以及是否要求整张单仅有一个进行中任务。
 * @returns 预读得到的唯一任务编号，证据不足时为 null。
 * @throws 无预期错误。
 */
export function getDetailOwnedRunningTask(options: {
  detail: JsonObject;
  userId: string;
  isSingleRunningTaskRequired?: boolean;
}): string | null {
  const tasks = readCompleteTaskDetails(options);
  // 并行任务可能让转交的接收人与当前处理人不同，转交核实要求整张单只有一个进行中任务。
  if (!tasks || (options.isSingleRunningTaskRequired && tasks.runningCount !== 1)) return null;
  return tasks.taskId;
}

/**
 * 确认详情里的本人任务确实由同一实例的任务列表返回。
 * @param options 本次实例、详情、任务列表及已核实用户。
 * @returns 证据不足时为 null，有证据但没有唯一进行中任务时任务编号为 null。
 * @throws 无预期错误。
 */
export function readApprovalTaskEvidence(options: {
  id: string;
  detail: JsonObject | null;
  taskList: JsonObject | null;
  userId: string;
}): ApprovalTaskEvidence | null {
  // 1. 核对同一实例的独立任务编号列表。2. 只用详情里的处理人和状态判定归属。
  const { id, detail, taskList, userId } = options;
  const listed = readListedTaskIds(id, taskList); // 1.
  if (!listed || detail?.processInstanceId !== id) return null;
  const evidence = readCompleteTaskDetails({ detail, userId }); // 2.
  if (!evidence) return null;
  const { taskId, endedTaskIds, detailOwnedRunningTaskIds } = evidence;
  return {
    taskId: taskId && listed.has(taskId) ? taskId : null,
    endedTaskIds: new Set([...endedTaskIds].filter((id) => listed.has(id))),
    detailOwnedRunningTaskIds,
  };
}
