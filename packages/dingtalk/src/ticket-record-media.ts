// 读取和合并记录中的附件与图片，供钉钉记录的安全投影使用。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { readAttachmentNames } from './ticket-values.ts';

function hasImageContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasImageContent);
  if (isObject(value)) return Object.values(value).some(hasImageContent);
  return value === true || (typeof value === 'number' && Number.isFinite(value));
}

function readImageItems(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  // CLI 常用 [null] 占位；过滤在统计和合并的共同入口进行，避免空媒体被当成真实内容。
  return value.filter(
    (item) => (typeof item === 'string' || isObject(item)) && hasImageContent(item),
  );
}

function getItemKey(item: unknown): string | undefined {
  return JSON.stringify(item, (_key, value: unknown) =>
    isObject(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
        )
      : value,
  );
}

function combineItems(first: unknown[], second: unknown[]): unknown[] {
  const items = [...first];
  const firstCounts = new Map<string | undefined, number>();
  const secondCounts = new Map<string | undefined, number>();
  for (const item of first) {
    const key = getItemKey(item);
    firstCounts.set(key, (firstCounts.get(key) ?? 0) + 1);
  }
  for (const item of second) {
    const key = getItemKey(item);
    const count = (secondCounts.get(key) ?? 0) + 1;
    secondCounts.set(key, count);
    // 同一接口的有效重复项仍计数；只抵消两个接口描述同一事件时的重叠图片。
    if (count > (firstCounts.get(key) ?? 0)) items.push(item);
  }
  return items;
}

/**
 * 统计接口已有的图片集合，不返回 URL 或原始图片对象。
 * @param record 记录对象中的 images 字段。
 * @returns 非空字符串或含有实际内容的对象数量；占位项和非数组集合为 0。
 * @throws 无。
 */
export function countRecordImages(record: JsonObject): number {
  return readImageItems(record.images).length;
}

/**
 * 提取钉钉已核实的图片字符串格式，供详情快照登记私有地址。
 * @param record 归并后的原始记录。
 * @returns 非空图片地址字符串；未确认的对象格式不转成地址。
 * @throws 无预期错误。
 */
export function readRecordImageUrls(record: JsonObject): string[] {
  return readImageItems(record.images).filter((item): item is string => typeof item === 'string');
}

/**
 * 统计接口明确给出的抄送人数，不猜测字符串或其他未知格式。
 * @param record 记录对象中的 ccUserIds 字段。
 * @returns 字符串标识数组的去重人数；不是数组或包含未知结构时为 null。
 * @throws 无；完整收件人标识不返回网页。
 */
export function countRecordRecipients(record: JsonObject): number | null {
  if (
    !Array.isArray(record.ccUserIds) ||
    !record.ccUserIds.every((value) => typeof value === 'string' && value.trim().length > 0)
  )
    return null;
  return new Set(record.ccUserIds).size;
}

/**
 * 合并同一事件或其附件容器中的媒体，保留双方的文件名与图片。
 * @param current 已有记录。
 * @param incoming 对应记录或媒体容器。
 * @returns 只含归并后附件与图片字段的对象，仍限于模块内存使用。
 * @throws 无；输入来自已解析 CLI JSON，不执行链接或序列化到日志。
 */
export function mergeRecordMedia(current: JsonObject, incoming: JsonObject): JsonObject {
  return {
    attachments: [
      ...new Set([
        ...readAttachmentNames(current.attachments),
        ...readAttachmentNames(incoming.attachments),
      ]),
    ].map((fileName) => ({ fileName })),
    images: combineItems(readImageItems(current.images), readImageItems(incoming.images)),
  };
}
