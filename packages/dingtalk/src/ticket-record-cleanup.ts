// 在排序前清理空记录，并把媒体容器归并到有依据的前一条真实记录，供详情和回复判断共用。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { countRecordImages, mergeRecordMedia } from './ticket-record-media.ts';
import { readAttachmentNames, readTicketText, readTicketTime } from './ticket-values.ts';

function normalizeRecord(record: JsonObject): JsonObject {
  // 已核对的两个接口分别使用 date/type/result 与 operationTime/operationType/operationResult。
  return {
    ...record,
    operationTime: readTicketTime(record.operationTime ?? record.date),
    operationType: readTicketText(record.operationType) ?? readTicketText(record.type),
    operationResult: readTicketText(record.operationResult) ?? readTicketText(record.result),
  };
}

/**
 * 读取已归一化的沟通记录时间，供显示排序和审批判断复用。
 * @param record 带 operationTime 的记录。
 * @returns 毫秒时间；缺失或非法时为 Infinity，供调用方识别。
 * @throws 无预期错误。
 */
export function readTicketRecordTime(record: JsonObject): number {
  const timestamp = Date.parse(readTicketText(record.operationTime) ?? '');
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

function hasRecordBody(record: JsonObject): boolean {
  return ['userId', 'userName', 'operationType', 'showName', 'operationResult', 'remark'].some(
    (field) => readTicketText(record[field]) !== null,
  );
}

function hasRecordMedia(record: JsonObject): boolean {
  return readAttachmentNames(record.attachments).length > 0 || countRecordImages(record) > 0;
}

function isEmptyRecord(record: JsonObject): boolean {
  // 空附件数组不构成内容；有人、时间、动作、意见或有效媒体的记录都必须保留。
  return (
    !hasRecordBody(record) &&
    readTicketText(record.operationTime) === null &&
    !hasRecordMedia(record)
  );
}

function isMediaContainer(record: JsonObject): boolean {
  return !hasRecordBody(record) && hasRecordMedia(record);
}

/**
 * 判断详情中的空占位或无动作的附件容器，供移交核实跳过。
 * @param record 钉钉详情中的原始记录。
 * @returns 既没有时间、节点和任务，也没有记录正文时为 true。
 * @throws 无预期错误。
 */
export function isTicketRecordPlaceholder(record: JsonObject): boolean {
  const normalized = normalizeRecord(record);
  // 真正的处理记录即使缺了一项也应保留，否则可能跳过首个动作而错认接收人。
  return (
    normalized.operationTime === null &&
    readTicketText(record.activityId) === null &&
    (record.taskId === null || record.taskId === undefined) &&
    !hasRecordBody(normalized)
  );
}

function findTimedPredecessor(records: JsonObject[], time: string): JsonObject | undefined {
  const timestamp = Date.parse(time);
  if (!Number.isFinite(timestamp)) return;
  let nearestTime = -Infinity;
  let candidates: JsonObject[] = [];
  for (const record of records) {
    if (isMediaContainer(record)) continue;
    const recordTime = readTicketRecordTime(record);
    if (!Number.isFinite(recordTime) || recordTime > timestamp || recordTime < nearestTime)
      continue;
    if (recordTime > nearestTime) candidates = [];
    nearestTime = recordTime;
    candidates.push(record);
  }
  // 同一时间有多条真实记录时不能猜附件归属，保留容器单独展示。
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * 1. 归一化字段并删空项；2. 在原顺序中找容器归属；3. 保留没有可信归属的媒体。
 * @param value 单一接口返回的记录数组。
 * @returns 尚未排序的有效记录；无时间的容器仅归入原序最近的前一真实记录。
 * @throws 无；不把 showName 当作人名，不丢弃孤立的有效附件或图片。
 */
export function cleanTicketRecords(value: unknown): JsonObject[] {
  // 1. 原数组保留供归属判断使用，不能先按时间排序再把容器随意挂到其他记录。
  const records = Array.isArray(value)
    ? value
        .filter(isObject)
        .map(normalizeRecord)
        .filter((record) => !isEmptyRecord(record))
    : [];
  const cleaned: JsonObject[] = [];
  let previousRecord: JsonObject | undefined;
  for (const record of records) {
    if (!isMediaContainer(record)) {
      previousRecord = record;
      cleaned.push(record);
      continue;
    }
    // 2. 有时间按最近前一时间匹配；无时间严格沿原始顺序找前一真实记录。
    const time = readTicketText(record.operationTime);
    const owner = time === null ? previousRecord : findTimedPredecessor(records, time);
    if (owner) Object.assign(owner, mergeRecordMedia(owner, record));
    else cleaned.push(record); // 3. 没有归属依据时保留媒体，不能因清理空占位而丢文件名。
  }
  return cleaned;
}
