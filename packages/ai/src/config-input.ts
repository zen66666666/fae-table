// 验证 AI 保存与测试请求字段，供配置服务和已保存设置的解析复用。
import { AppError, getAiAddress, isAiModel, isObject } from '../../core/src/index.ts';
import type { AiConfigInput, AiModelsInput } from '../../core/src/index.ts';
import { KEY_SUFFIX_LENGTH, MAX_KEY_LENGTH } from './constants.ts';

/**
 * 检查 Key 是否可安全作为 Bearer 凭据发送。
 * @param value 待检查的 Key。
 * @returns 非空且可作为 HTTP 授权头传输时为 true。
 * @throws 不抛出错误。
 */
export function isAiKey(value: string): boolean {
  return value.length <= MAX_KEY_LENGTH && /^[\x21-\x7e]+$/u.test(value);
}

/**
 * 取得公开状态允许展示的 Key 后缀。
 * @param apiKey 有效的内存凭据。
 * @returns 末四位，Key 较短时返回空字符串以免公开整个 Key。
 * @throws 不抛出错误。
 */
export function getKeyLastFour(apiKey: string): string {
  return apiKey.length > KEY_SUFFIX_LENGTH ? apiKey.slice(-KEY_SUFFIX_LENGTH) : '';
}

/**
 * 判断可公开字段是否包含实际 Key；短 Key 仅比较完整字段以避免误伤正常文本。
 * @param value 待公开的非秘密字段。
 * @param apiKey 已校验的实际凭据。
 * @returns 值包含可识别的完整 Key 时为 true。
 * @throws 不抛出错误。
 */
export function hasAiKeyText(value: string, apiKey: string): boolean {
  return value.trim() === apiKey || (apiKey.length > KEY_SUFFIX_LENGTH && value.includes(apiKey));
}

/**
 * 校验请求形状并规范化非秘密输入。
 * @param value 请求发送的配置对象。
 * @returns 地址、模型及可为空的 Key。
 * @throws AppError 包含安全的校验原因。
 */
export function readAiConfigInput(value: unknown): AiConfigInput {
  if (!isObject(value) || typeof value.model !== 'string') {
    throw new AppError('validation', 'invalid_ai_fields', 'ai-config');
  }
  const { model, ...credentials } = value;
  return { ...readAiModelsInput(credentials), model };
}

/**
 * 读取模型列表请求使用的地址和 Key 字段。
 * @param value 请求发送的对象。
 * @returns 地址和可为空的 Key。
 * @throws AppError 请求包含其他字段或字段类型不正确。
 */
export function readAiModelsInput(value: unknown): AiModelsInput {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => key !== 'address' && key !== 'apiKey') ||
    typeof value.address !== 'string' ||
    (value.apiKey !== undefined && typeof value.apiKey !== 'string')
  ) {
    throw new AppError('validation', 'invalid_ai_fields', 'ai-config');
  }
  return { address: value.address, apiKey: value.apiKey ?? '' };
}

/**
 * 检查基础地址、模型和授权头输入，并规范化用于保存和对比的配置。
 * @param value 待保存或测试的输入。
 * @returns 校验后的规范地址、模型及可为空的 Key。
 * @throws AppError 包含安全的校验原因。
 */
export function parseAiConfig(value: unknown): AiConfigInput {
  // 1. 限定请求结构。2. 校验模型与地址、Key。
  const { model, ...credentials } = readAiConfigInput(value); // 1.
  if (!isAiModel(model)) throw new AppError('validation', 'invalid_ai_model', 'ai-config'); // 2.
  return { ...parseAiModelsInput(credentials), model };
}

/**
 * 检查并规范化地址及 Key 输入，供发现模型、测试及保存共用。
 * @param value 待校验的地址与 Key 请求。
 * @returns 规范化的地址与可为空的 Key。
 * @throws AppError 地址、Key 或请求格式无效。
 */
export function parseAiModelsInput(value: unknown): AiModelsInput {
  const { address: source, apiKey } = readAiModelsInput(value);
  const address = getAiAddress(source);
  if (!address) throw new AppError('validation', 'invalid_ai_address', 'ai-config');
  if (apiKey !== '' && !isAiKey(apiKey)) {
    throw new AppError('validation', 'invalid_ai_key', 'ai-config');
  }
  address.pathname = address.pathname.replace(/\/+$/u, '');
  return { address: address.href, apiKey };
}
