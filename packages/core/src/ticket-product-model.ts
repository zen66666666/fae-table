// 识别已读单据中固定的产品型号字段，供编码表和官网手册匹配使用。
import type { TicketField } from './ticket-types.ts';

const PRODUCT_MODEL_FIELD = '产品型号';
const PRODUCT_MODEL_FIELD_TYPE = 'TextField';
const MODEL_SEPARATORS = /[,，、;；\r\n]+|\s+\/\s+/u;

function isProductModelField(field: TicketField): boolean {
  return (
    field.type === PRODUCT_MODEL_FIELD_TYPE &&
    field.label?.trim() === PRODUCT_MODEL_FIELD &&
    Boolean(field.text?.trim())
  );
}

/**
 * 从已投影详情取唯一指定来源的产品型号，避免将备注、客户文本或任意参数作为查询。
 * @param fields 来自单据详情的只读字段集合。
 * @returns 第一个有内容的产品型号字段文本；缺失时返回 null。
 * @throws 无预期错误。
 */
export function getTicketProductModel(fields: readonly TicketField[]): string | null {
  return fields.find(isProductModelField)?.text ?? null;
}

/**
 * 按表单顺序提取手册区的多个产品型号，去掉空项和重复值。
 * @param fields 当前单据已投影的表单字段。
 * @returns 固定产品型号字段中的文本项；型号内紧邻字符的斜线仍作为型号内容。
 * @throws 无预期错误；官网能否查询仍由手册模块校验。
 */
export function getTicketProductModels(fields: readonly TicketField[]): string[] {
  const models = fields
    .filter(isProductModelField)
    .flatMap(({ text }) => text?.split(MODEL_SEPARATORS) ?? [])
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(models)];
}
