// 将已校验的审批列表和详情投影为共享展示类型，业务内容始终只在内存中流转。
import { AppError, isObject } from '../../core/src/index.ts';
import type { JsonObject, TicketSource, TicketSummary, TicketTask } from '../../core/src/index.ts';
import { findSupportTemplate, isCurrentTaskActor } from './approval-reading.ts';
import { formatTicketMember, readTicketText, readTicketTime } from './ticket-values.ts';

/** 单据摘要投影参数；回退摘要只能来自同一实例的最近列表。 */
export type TicketSummaryProjection = {
  payload: JsonObject;
  userId: string;
  source?: TicketSource;
  fallback?: TicketSummary;
  names?: ReadonlyMap<string, string>;
};

/**
 * 从明确的接口字段生成单据摘要，缺少字段时保留 null。
 * @param options 列表或详情对象、当前身份及可选列表回退信息。
 * @returns 不包含原始表单与完整成员标识的摘要。
 * @throws AppError 缺少实例标识时抛出；调用方应先完成集合结构校验。
 */
export function projectTicketSummary(options: TicketSummaryProjection): TicketSummary {
  const { payload, fallback, userId } = options;
  const id = readTicketText(payload.processInstanceId) ?? fallback?.id;
  if (!id) throw new AppError('structure', 'missing_instance_id', 'ticket summary');
  return {
    id,
    title:
      readTicketText(payload.processInstanceTitle) ??
      readTicketText(payload.title) ??
      fallback?.title ??
      null,
    templateName: findSupportTemplate(payload) ?? fallback?.templateName ?? null,
    initiator: formatTicketMember({
      name:
        readTicketText(payload.originatorName) ??
        options.names?.get(readTicketText(payload.originatorUserid) ?? '') ??
        fallback?.initiator,
      userId: payload.originatorUserid,
      currentUserId: userId,
      names: options.names,
    }),
    createdAt: readTicketTime(payload.createTime) ?? fallback?.createdAt ?? null,
    status: readTicketText(payload.status) ?? fallback?.status ?? null,
    sources: options.source ? [options.source] : [...(fallback?.sources ?? [])],
    isCurrentActor: isCurrentTaskActor(payload.tasks, userId),
    hasReplied: null,
  };
}

/**
 * 按实例合并两个来源的摘要，保留所有实际来源和已有字段。
 * @param current 已有摘要。
 * @param incoming 另一来源或另一页读到的同实例摘要。
 * @returns 合并后的摘要；不会根据来源推测当前处理人。
 * @throws 无；调用方负责确保实例标识一致。
 */
export function mergeTicketSummary(current: TicketSummary, incoming: TicketSummary): TicketSummary {
  return {
    id: current.id,
    title: current.title ?? incoming.title,
    templateName: current.templateName ?? incoming.templateName,
    initiator: current.initiator ?? incoming.initiator,
    createdAt: current.createdAt ?? incoming.createdAt,
    status: current.status ?? incoming.status,
    sources: [...new Set([...current.sources, ...incoming.sources])],
    isCurrentActor:
      current.isCurrentActor === true || incoming.isCurrentActor === true
        ? true
        : (current.isCurrentActor ?? incoming.isCurrentActor),
    hasReplied: current.hasReplied ?? incoming.hasReplied,
  };
}

/**
 * 合并详情任务与任务接口给出的同标识信息。
 * @param detailTasks 详情中的任务集合。
 * @param taskIds 任务接口返回的 taskIdList，可能只含标识。
 * @returns 仅留在模块内存中的任务对象；仅有 ID 不会被猜测成运行中任务。
 * @throws 无。
 */
export function mergeTicketTasks(detailTasks: unknown, taskIds: unknown): JsonObject[] {
  const tasks = Array.isArray(detailTasks)
    ? detailTasks.filter(isObject).map((task) => ({ ...task }))
    : [];
  for (const task of Array.isArray(taskIds) ? taskIds.filter(isObject) : []) {
    const index = tasks.findIndex(
      (current) => current.taskId !== undefined && String(current.taskId) === String(task.taskId),
    );
    if (index >= 0) tasks[index] = { ...tasks[index], ...task };
    else tasks.push({ ...task });
  }
  return tasks;
}

/**
 * 只展示运行中的任务，已完成历史任务仅可作为处理记录展示。
 * @param options 合并后的任务、已核实当前用户和可选姓名映射。
 * @returns 当前任务的处理人、状态与是否是我。
 * @throws 无。
 */
export function projectCurrentTasks(options: {
  tasks: JsonObject[];
  userId: string;
  names?: ReadonlyMap<string, string>;
}): TicketTask[] {
  return options.tasks
    .filter((task) => task.taskStatus === 'RUNNING')
    .map((task) => ({
      actor: formatTicketMember({
        name: task.userName,
        userId: task.userId,
        currentUserId: options.userId,
        names: options.names,
      }),
      status: readTicketText(task.taskStatus),
      isMine: task.userId === options.userId,
    }));
}
