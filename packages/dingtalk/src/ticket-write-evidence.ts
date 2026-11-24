// 将详情预读收集的写入证据绑定到详情快照，仅供钉钉模块和后台写回复用。
import type { JsonObject, TicketDetail } from '../../core/src/index.ts';
import {
  getDetailOwnedRunningTask,
  hasDetailOwnedRunningTask,
  readApprovalTaskEvidence,
} from './approval-task-evidence.ts';
import type { ApprovalEvidence } from './approval-write-evidence.ts';
import { readWriteRecords } from './approval-write-records.ts';
import { isCompleteDingtalkResult } from './common.ts';
import type { Identity } from './identity.ts';
import { readTicketText } from './ticket-values.ts';

type DetailEvidence = ApprovalEvidence & {
  hasOwnedRunningTask: boolean | null;
};

const DETAIL_EVIDENCE = new WeakMap<TicketDetail['tasks'], DetailEvidence>();

/**
 * 收集本次详情的数据证据，供后续写入使用，不发起额外请求。
 * @param options 网页详情投影、原始详情及两个辅助读取结果和已核实身份。
 * @returns 无返回值；随同一投影的任务数组在内存中保留证据。
 * @throws 无预期错误；不完整的原始字段标记为证据不足。
 */
export function rememberTicketWriteEvidence(options: {
  detail: TicketDetail;
  rawDetail: JsonObject;
  taskList: JsonObject | null;
  supplemental: JsonObject | null;
  identity: Identity;
}): void {
  const { detail, rawDetail, taskList, supplemental, identity } = options;
  const { id } = detail.summary;
  const raw = { detail: rawDetail, userId: identity.userId };
  const tasks = readApprovalTaskEvidence({ ...raw, id, taskList });
  // 后台可能复制摘要；任务数组在相同详情内稳定，且私有证据不能随 API 投影序列化。
  DETAIL_EVIDENCE.set(detail.tasks, {
    id,
    identity,
    tasks,
    status: isCompleteDingtalkResult(rawDetail)
      ? (readTicketText(rawDetail.status)?.toUpperCase() ?? null)
      : null,
    records: readWriteRecords(rawDetail, supplemental),
    ownedTaskId: getDetailOwnedRunningTask(raw),
    hasOwnedRunningTask: tasks
      ? tasks.detailOwnedRunningTaskIds.size > 0
      : hasDetailOwnedRunningTask(raw),
  });
}

/**
 * 获取同一详情快照的私有写入证据，供钉钉写入器使用。
 * @param detail 当前账号的详情快照，或未读到详情时的 null。
 * @returns 同一单据的内部证据；手动构造或单据不符时返回 null。
 * @throws 无预期错误。
 */
export function getTicketWriteEvidence(detail: TicketDetail | null): DetailEvidence | null {
  if (!detail) return null;
  const evidence = DETAIL_EVIDENCE.get(detail.tasks);
  return evidence?.id === detail.summary.id ? evidence : null;
}

/**
 * 查询预读详情登记的唯一本人进行中任务，供后台准备审批使用。
 * @param detail 当前列表成员已预读的详情快照。
 * @returns 本机预览使用的任务编号，或 null；编号不会随详情序列化。
 * @throws 无预期错误。
 */
export function getTicketOwnedRunningTask(detail: TicketDetail): string | null {
  return getTicketWriteEvidence(detail)?.ownedTaskId ?? null;
}

/**
 * 核实已读详情是否仍有任意一个本人的进行中任务，供刷新单据来源使用。
 * @param detail 当前列表成员已读到的详情快照。
 * @returns 已核实的布尔值；任务数据不完整或没有证据时为 null。
 * @throws 无预期错误。
 */
export function hasTicketOwnedRunningTask(detail: TicketDetail): boolean | null {
  return getTicketWriteEvidence(detail)?.hasOwnedRunningTask ?? null;
}
