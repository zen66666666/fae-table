// 统一规范化单据型号及官网型号，只用于可公开的精确查询键。
import { MANUAL_MODEL_MAX_LENGTH } from './constants.ts';

const MODEL_CHARACTERS = /^[A-Za-z\d()./\-]+$/u;
const MODEL_SUFFIX = /(?:\([^()]*\)|-[A-Z]{1,3})$/u;

/**
 * 去掉空白、转换全角括号并大写，验证官网查询的唯一用户输入。
 * @param value 单据已投影的产品型号，或官网返回的型号文字。
 * @returns 合法型号键，空值或非法字符、长度返回 null。
 * @throws 无预期错误。
 */
export function normalizeManualModel(value: string): string | null {
  const model = value.replace(/\s+/gu, '').replaceAll('（', '(').replaceAll('）', ')');
  // 校验字母后才大写，避免 Unicode 字母借大小写折叠被当成合法的 ASCII 型号。
  if (model.length > MANUAL_MODEL_MAX_LENGTH || !MODEL_CHARACTERS.test(model)) return null;
  return model.toUpperCase();
}

/**
 * 取官网允许再试一次的型号后缀回退键。
 * @param model 已合法规范化的型号键。
 * @returns 去掉一个末尾括号说明或短字母后缀的型号；无回退时返回 null。
 * @throws 无预期错误。
 */
export function getManualBaseModel(model: string): string | null {
  const base = model.replace(MODEL_SUFFIX, '');
  return base && base !== model ? base : null;
}
