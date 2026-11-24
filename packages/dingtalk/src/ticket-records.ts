// 按已核对的结构合并详情与记录接口，生成安全时间线并登记图片编号。
import type { JsonObject, TicketDetail, TicketRecord } from '../../core/src/index.ts';
import { formatTicketMember, readAttachmentNames, readTicketText } from './ticket-values.ts';
import { cleanTicketRecords, readTicketRecordTime } from './ticket-record-cleanup.ts';
import {
  countRecordImages,
  countRecordRecipients,
  mergeRecordMedia,
  readRecordImageUrls,
} from './ticket-record-media.ts';

const COMMENT_ACTIONS = new Set(['COMMENT', 'ADD_REMARK']);
const RECORD_IMAGE_URLS = new WeakMap<TicketRecord[], ReadonlyMap<string, string>>();
const TICKET_MENTION_PATTERN = /\[([^\[\]\r\n\v\f\u0085\u2028\u2029]{1,64})\]\([0-9]+\)/gu;

function hasSameRecordIdentity(current: JsonObject, incoming: JsonObject): boolean {
  return (
    readTicketText(current.userId) !== null &&
    readTicketText(current.operationTime) !== null &&
    readTicketText(current.operationType) !== null &&
    current.userId === incoming.userId &&
    current.operationTime === incoming.operationTime &&
    current.operationType === incoming.operationType
  );
}

function combineRecord(current: JsonObject, incoming: JsonObject): JsonObject {
  return {
    ...current,
    ...incoming,
    ...mergeRecordMedia(current, incoming),
    operationResult:
      readTicketText(incoming.operationResult) ?? readTicketText(current.operationResult),
    remark: readTicketText(incoming.remark) ?? readTicketText(current.remark),
    userName: readTicketText(incoming.userName) ?? readTicketText(current.userName),
    showName: readTicketText(incoming.showName) ?? readTicketText(current.showName),
    ccUserIds: Array.isArray(incoming.ccUserIds) ? incoming.ccUserIds : current.ccUserIds,
  };
}

function canCombineRecord(current: JsonObject, incoming: JsonObject): boolean {
  return ['operationResult', 'remark'].every((key) => {
    const currentValue = readTicketText(current[key]);
    const incomingValue = readTicketText(incoming[key]);
    return currentValue === null || incomingValue === null || currentValue === incomingValue;
  });
}

function readRecordComment(value: unknown): string | null {
  const text = readTicketText(value);
  // 评论和系统动作的意见共用此字段；只转换有明确数字标识的提及，避免把普通链接误当成姓名。
  return text === null ? null : text.replaceAll(TICKET_MENTION_PATTERN, '@$1');
}

/**
 * 在指定详情的私有映射中查询图片地址，供已核验成员资格的后台读取。
 * @param options 当前缓存详情和本次快照发放的图片编号。
 * @returns 仅供后台使用的地址；当前快照没有该图片时返回 undefined。
 * @throws 无预期错误。
 */
export function getTicketRecordImageUrl(options: {
  detail: TicketDetail;
  imageId: string;
}): string | undefined {
  return RECORD_IMAGE_URLS.get(options.detail.records)?.get(options.imageId);
}

/**
 * 合并两套记录，仅在处理人、时间和动作唯一匹配时补充意见、附件等字段。
 * @param detailRecords 详情接口内的完整记录集合。
 * @param operationRecords 独立记录接口的集合，失败时可省略。
 * @returns 留在模块内存中的记录，按实际时间排列；无法唯一匹配时保留双方。
 * @throws 无；绝不按数组位置配对，避免把意见归到错误的处理人。
 */
export function mergeTicketRecords(
  detailRecords: unknown,
  operationRecords: unknown,
): JsonObject[] {
  // 每个来源先按自己的原序归并附件，再跨来源匹配；否则无时间容器可能挂到另一来源的错误记录。
  const records = cleanTicketRecords(detailRecords);
  const incomingRecords = cleanTicketRecords(operationRecords);
  for (const incoming of incomingRecords) {
    const candidates = records
      .map((record, index) => (hasSameRecordIdentity(record, incoming) ? index : -1))
      .filter((index) => index >= 0);
    const isUnique =
      incomingRecords.filter((record) => hasSameRecordIdentity(record, incoming)).length === 1;
    // 两边都唯一且没有意见或结果冲突才能合并，避免静默覆盖另一条真实记录。
    if (candidates.length === 1 && isUnique && canCombineRecord(records[candidates[0]], incoming))
      records[candidates[0]] = combineRecord(records[candidates[0]], incoming);
    else records.push(incoming);
  }
  return records.sort((left, right) => readTicketRecordTime(left) - readTicketRecordTime(right));
}

/**
 * 将已清理记录投影为评论和系统事件，未知对象和身份标识不发送给网页。
 * @param options 已清理记录、当前身份、可选姓名映射及当前单据的图片编号生成函数。
 * @returns 纯文本记录、文件名、媒体数量及当前快照图片编号。
 * @throws 无。
 */
export function projectTicketRecords(options: {
  records: JsonObject[];
  userId: string;
  names?: ReadonlyMap<string, string>;
  createImageId: (url: string) => string;
}): TicketRecord[] {
  // 1. 按本次读取范围生成图片编号。2. 只在私有映射保存原始地址。
  const imageUrls = new Map<string, string>();
  const records = options.records.map(
    (record): TicketRecord => ({
      actor: formatTicketMember({
        name: record.userName,
        userId: record.userId,
        currentUserId: options.userId,
        names: options.names,
      }),
      action: readTicketText(record.operationType),
      result: readTicketText(record.operationResult),
      time: readTicketText(record.operationTime),
      comment: readRecordComment(record.remark),
      actionName: readTicketText(record.showName),
      isMine: record.userId === options.userId,
      imageCount: countRecordImages(record),
      imageIds: readRecordImageUrls(record).map((url) => {
        // 1.
        const id = options.createImageId(url);
        imageUrls.set(id, url);
        return id;
      }),
      attachments: readAttachmentNames(record.attachments),
      recipientCount: countRecordRecipients(record),
      kind: classifyRecordKind(record),
    }),
  );
  // 2. 即使编号保持稳定，也只能从最新快照查找其中仍包含的图片。
  if (imageUrls.size) RECORD_IMAGE_URLS.set(records, imageUrls);
  return records;
}

/**
 * 识别钉钉沟通记录的已知评论动作，供显示与写入复核共用。
 * @param action 上游处理记录的动作值。
 * @returns 对应评论活动时为 true。
 * @throws 无预期错误。
 */
export function isTicketCommentAction(action: string): boolean {
  return COMMENT_ACTIONS.has(action.toUpperCase());
}

function classifyRecordKind(record: JsonObject): TicketRecord['kind'] {
  const action = readTicketText(record.operationType);
  // ADD_REMARK 已由真实接口核实为评论；同意、拒绝等其他动作即使有意见也仍是系统事件。
  if (action !== null) return isTicketCommentAction(action) ? 'comment' : 'system';
  return readTicketText(record.remark) !== null ||
    countRecordImages(record) > 0 ||
    readAttachmentNames(record.attachments).length > 0
    ? 'comment'
    : 'system';
}
