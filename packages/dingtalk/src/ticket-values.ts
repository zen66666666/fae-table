// 将审批字段和成员标识投影为纯文本，供单据列表及详情共享，不传递原始复杂对象。
import { isObject } from '../../core/src/index.ts';
import type { TicketField } from '../../core/src/index.ts';
import { parseAttachmentItems } from './readonly-payload.ts';

const UNSUPPORTED_FIELD_TEXT = '暂不支持显示此类字段';
const ATTACHMENT_COMPONENT = 'DDAttachment';
const TEXT_COMPONENTS = new Set(['TextField', 'TextareaField']);
const CURRENT_USER_TEXT = '我';
const MEMBER_ID_SUFFIX_LENGTH = 4;
const MILLISECOND_TIMESTAMP_PATTERN = /^\d{13}$/;

/**
 * 读取接口的字符串字段，缺失与非字符串值不猜测为文本。
 * @param value 接口中的单个值。
 * @returns 原始纯文本或 null。
 * @throws 无。
 */
export function readTicketText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * 将已核对的毫秒时间戳转为 ISO 文本，已有时间文本保持原值。
 * @param value 接口中的时间字段。
 * @returns 可显示的时间文本；缺少或无效的数值时间返回 null。
 * @throws 无。
 */
export function readTicketTime(value: unknown): string | null {
  // 真实列表是十三位毫秒字符串，与详情数值完全相等；记录接口也使用毫秒数值。
  const timestamp =
    typeof value === 'string' && MILLISECOND_TIMESTAMP_PATTERN.test(value) ? Number(value) : value;
  if (typeof timestamp === 'number') {
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return readTicketText(value);
}

/**
 * 本人固定显示“我”；其他人优先接口姓名和已核实姓名缓存，最后回退成员标识末四位。
 * @param options 接口姓名、姓名映射、成员标识和已核实的当前用户标识。
 * @returns 供本机页面使用的成员文本；缺少所有信息时返回 null。
 * @throws 无；不调用通讯录。
 */
export function formatTicketMember(options: {
  name?: unknown;
  userId: unknown;
  currentUserId: string;
  names?: ReadonlyMap<string, string>;
}): string | null {
  const userId = readTicketText(options.userId);
  if (userId === options.currentUserId) return CURRENT_USER_TEXT;
  const name =
    readTicketText(options.name) ?? readTicketText(userId ? options.names?.get(userId) : null);
  if (name) return name;
  if (!userId) return null;
  return `成员（${userId.slice(-MEMBER_ID_SUFFIX_LENGTH)}）`;
}

/**
 * 从附件数组提取文件名，去除可能夹带的目录和链接。
 * @param value 接口返回的附件数组或数组字符串。
 * @returns 去重后的名称；不含链接、文件标识或原始附件对象。
 * @throws 无；无法识别的附件不生成猜测名称。
 */
export function readAttachmentNames(value: unknown): string[] {
  const names = new Set<string>();
  for (const entry of parseAttachmentItems(value) ?? []) {
    if (!isObject(entry)) continue;
    const name = readTicketText(entry.fileName) ?? readTicketText(entry.name);
    // 网页只展示文件名；URL 不能伪装成附件名称穿过投影层。
    if (!name || /^[a-z][a-z\d+.-]*:\/\//i.test(name)) continue;
    const filename = name.split(/[\\/]/).at(-1);
    if (filename) names.add(filename);
  }
  return [...names];
}

function isComplexString(value: string): boolean {
  if (!/^[\s]*[\[{]/.test(value)) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) || isObject(parsed);
  } catch {
    return false;
  }
}

function readFieldText(value: unknown, type: string | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (type === ATTACHMENT_COMPONENT) {
    const names = readAttachmentNames(value);
    if (names.length) return names.join('\n');
    return parseAttachmentItems(value)?.length === 0 ? null : UNSUPPORTED_FIELD_TEXT;
  }
  // 已确认的文本组件即使填写了 JSON 也仍是文本；其他复杂字段必须先明确格式才能展示。
  if (typeof value === 'string') {
    return TEXT_COMPONENTS.has(type ?? '') || !isComplexString(value)
      ? value
      : UNSUPPORTED_FIELD_TEXT;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return UNSUPPORTED_FIELD_TEXT;
}

/**
 * 将已校验的表单集合投影为标签、显示文本和组件类型。
 * @param value 接口中的 formValueVOS。
 * @returns 不包含原始 JSON 的字段展示集合。
 * @throws 无；无法识别的复杂字段显示固定提示。
 */
export function projectTicketFields(value: unknown): TicketField[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((field) => {
    const type = readTicketText(field.componentType);
    return { label: readTicketText(field.name), text: readFieldText(field.value, type), type };
  });
}

/**
 * 汇总表单与详情、处理记录中已经返回的附件名。
 * @param options 表单、详情附件和处理记录；只读取既有字段。
 * @returns 去重的附件名称，不含下载地址。
 * @throws 无。
 */
export function collectTicketAttachments(options: {
  fields: unknown;
  attachments: unknown;
  records: unknown;
}): string[] {
  const names = new Set(readAttachmentNames(options.attachments));
  const addNames = (value: unknown) =>
    readAttachmentNames(value).forEach((name) => names.add(name));
  if (Array.isArray(options.fields)) {
    for (const field of options.fields.filter(isObject)) {
      if (field.componentType === ATTACHMENT_COMPONENT) addNames(field.value);
    }
  }
  if (Array.isArray(options.records)) {
    for (const record of options.records.filter(isObject)) addNames(record.attachments);
  }
  return [...names];
}
