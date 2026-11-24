// 规范化审批详情中的写入证据，供钉钉模块比较写入前后的处理记录。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { readApprovalTaskId } from './approval-write-policy.ts';
import { isCompleteDingtalkResult } from './common.ts';
import { isTicketRecordPlaceholder } from './ticket-record-cleanup.ts';
import { readTicketText, readTicketTime } from './ticket-values.ts';

type RecordIdentity = { id: string | null; time: number; type: string; result: string | null };
type RecordActor = { correlation: string | null; actor: string | null; key: string };

/** 已规范化的详情记录；补充用户只用于确认写入确实发生。 */
export type ApprovalWriteRecord = RecordActor & {
  supplementalActor: string | null;
  time: number;
  type: string;
  result: string | null;
  remark: string | null;
  taskId: string | null;
  activityId: string | null;
  targetActivityId: string | null;
  revertAction: string | null;
};

/** 详情和补充信息分开保留，不能用补充接口代替详情。 */
export type ApprovalWriteRecords = {
  rows: ApprovalWriteRecord[];
  supplementalRows: RecordActor[] | null;
};

function readRecordId(row: JsonObject): string | null {
  const value = row.operationRecordId ?? row.recordId;
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : readTicketText(value);
}

function readIdentity(row: JsonObject): RecordIdentity | null {
  const type = (readTicketText(row.operationType) ?? readTicketText(row.type))?.toUpperCase();
  const result =
    (readTicketText(row.operationResult) ?? readTicketText(row.result))?.toUpperCase() ?? null;
  const time = Date.parse(readTicketTime(row.operationTime ?? row.date) ?? '');
  const id = readRecordId(row);
  // 没有编号、有效时间或动作的记录无法稳定地比较是否新增。
  return type && (id || Number.isFinite(time)) ? { id, time, type, result } : null;
}

function getCorrelation(identity: RecordIdentity): string | null {
  const { time, type, result } = identity;
  return Number.isFinite(time) ? JSON.stringify([time, type, result]) : null;
}

function readDetailRecord(row: JsonObject, identity: RecordIdentity): ApprovalWriteRecord {
  const { id, time, type, result } = identity;
  const actor = readTicketText(row.userId);
  const remark = typeof row.remark === 'string' ? row.remark : null;
  const taskId = readApprovalTaskId(row.taskId);
  const activityId = readTicketText(row.activityId);
  const targetActivityId = readTicketText(row.targetActivityId);
  const revertAction = readTicketText(row.revertAction);
  return {
    key: JSON.stringify([
      id,
      time,
      type,
      result,
      actor,
      remark,
      taskId,
      activityId,
      targetActivityId,
      revertAction,
    ]),
    correlation: getCorrelation(identity),
    actor,
    supplementalActor: null,
    time,
    type,
    result,
    remark,
    taskId,
    activityId,
    targetActivityId,
    revertAction,
  };
}

function readSupplementalRecord(row: JsonObject, identity: RecordIdentity): RecordActor {
  const correlation = getCorrelation(identity);
  const actor = readTicketText(row.userId);
  return { key: JSON.stringify([identity.id, correlation, actor]), correlation, actor };
}

function readRecords<Record>(
  payload: JsonObject | null,
  project: (row: JsonObject, identity: RecordIdentity) => Record,
): Record[] | null {
  if (!payload || !isCompleteDingtalkResult(payload)) return null;
  const rows = payload.operationRecords;
  if (!Array.isArray(rows)) return null;
  const ids = new Set<string>();
  const records: Record[] = [];
  for (const row of rows) {
    if (!isObject(row)) return null;
    const identity = readIdentity(row);
    // 空占位没有真实处理动作；带编号的异常行保留校验，避免漏掉实际写入。
    if (!identity && readRecordId(row) === null && isTicketRecordPlaceholder(row)) continue;
    if (!identity || (identity.id && ids.has(identity.id))) return null;
    if (identity.id) ids.add(identity.id);
    records.push(project(row, identity));
  }
  return records;
}

function findUniqueCorrelations<Record extends RecordActor>(
  rows: readonly Record[],
): Map<string, Record | null> {
  const matches = new Map<string, Record | null>();
  for (const row of rows) {
    if (!row.correlation) continue;
    matches.set(row.correlation, matches.has(row.correlation) ? null : row);
  }
  return matches;
}

/**
 * 读详情中的完整意见和任务映射，补充接口仅补齐能双向唯一配对的处理人。
 * @param detail 批次内的同一实例详情，缺失或结构未知时返回 null。
 * @param supplementary 可选的同一实例记录接口返回值。
 * @returns 分离的详情证据和补充证据。
 * @throws 无预期错误。
 */
export function readWriteRecords(
  detail: JsonObject | null,
  supplementary: JsonObject | null = null,
): ApprovalWriteRecords | null {
  // 1. 校验详情记录。2. 只按相同时间、动作、结果唯一关联已核实的用户。
  const rows = readRecords(detail, readDetailRecord); // 1.
  if (!rows) return null;
  const supplementalRows =
    detail?.processInstanceId === supplementary?.processInstanceId
      ? readRecords(supplementary, readSupplementalRecord)
      : null;
  if (!supplementalRows) return { rows, supplementalRows };
  const detailByCorrelation = findUniqueCorrelations(rows);
  const supplementalByCorrelation = findUniqueCorrelations(supplementalRows);
  for (const row of rows) {
    // 2. 原始详情已带用户时直接使用；重复时间和动作不能猜测用户归属。
    if (row.actor || !row.correlation || detailByCorrelation.get(row.correlation) !== row) continue;
    row.supplementalActor = supplementalByCorrelation.get(row.correlation)?.actor ?? null;
  }
  return { rows, supplementalRows };
}

/**
 * 按记录条数比较快照，识别新增条目和不再完整一致的旧条目。
 * @param options 同一个来源的前后快照。
 * @returns 新增记录，以及是否能从新快照找齐全部旧记录。
 * @throws 无预期错误。
 */
export function compareWriteRecords<Record extends { key: string }>(options: {
  before: readonly Record[];
  after: readonly Record[];
}): { added: Record[]; hasBaseline: boolean } {
  const counts = new Map<string, number>();
  for (const { key } of options.before) counts.set(key, (counts.get(key) ?? 0) + 1);
  const added = options.after.filter(({ key }) => {
    const previous = counts.get(key) ?? 0;
    if (!previous) return true;
    if (previous === 1) counts.delete(key);
    else counts.set(key, previous - 1);
    return false;
  });
  return { added, hasBaseline: counts.size === 0 };
}
