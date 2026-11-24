// 投影公开配置状态和固定校验结果，供本机 AI 服务复用。
import { AppError } from '../../core/src/index.ts';
import type { AiConfigInput, AiModelsInput, AiStatus, AiTestResult } from '../../core/src/index.ts';
import { hasAiKeyText } from './config-input.ts';
import type { AiSettings } from './storage.ts';

/**
 * 从已保存的设置和可安全显示的凭据后缀生成公开状态。
 * @param settings 已保存的普通设置。
 * @param suffix Key 的安全后缀；没有有效 Key 时为 null。
 * @returns 仅含网页可读取信息的状态。
 * @throws 无预期错误。
 */
export function getPublicStatus(settings: AiSettings, suffix: string | null): AiStatus {
  const list = suffix !== null ? settings.modelList : undefined;
  return {
    isConfigured: suffix !== null,
    address: settings.address,
    model: settings.model,
    keyLastFour: suffix ?? '',
    lastTest: suffix !== null ? settings.lastTest : null,
    ...(list ? { ...list, models: [...list.models] } : undefined),
  };
}

/**
 * 检查测试使用的地址和模型是否与当前已保存设置相同。
 * @param settings 当前已保存设置，可能为空。
 * @param config 本轮 AI 接口配置。
 * @returns 地址和模型一致时为 true。
 * @throws 无预期错误。
 */
export function isMatchingSettings(
  settings: AiSettings | null,
  config: AiConfigInput,
): settings is AiSettings {
  return Boolean(
    settings && settings.address === config.address && settings.model === config.model,
  );
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * 验证普通设置中没有和实际 Key 相同的明文内容。
 * @param config 已规范化的地址及 Key，保存时也包括模型。
 * @returns 无；普通字段可公开保存时正常返回。
 * @throws AppError 公开字段检测到有效 Key。
 */
export function assertDistinctPublicFields(config: AiModelsInput & { model?: string }): void {
  // API 版本等正常查询参数可用；有效 Key 重复填在明文字段中会破坏凭据分离。
  const url = new URL(config.address);
  const fields = [
    config.model ?? '',
    url.hostname,
    ...url.searchParams.keys(),
    ...url.searchParams.values(),
    decodePathSegment(url.pathname),
    ...url.pathname.split('/').map(decodePathSegment),
  ];
  if (fields.some((field) => hasAiKeyText(field, config.apiKey))) {
    throw new AppError('validation', 'ai_credential_in_public_fields', 'ai-config');
  }
}

/**
 * 将配置或测试输入错误归类，避免把源信息或错误细节返给网页。
 * @param error 内部校验错误。
 * @returns 固定的安全错误类别。
 * @throws 无预期错误。
 */
export function classifyInputError(error: unknown): AiTestResult {
  if (error instanceof AppError) {
    if (error.subtype === 'ai_key_required') return { kind: 'key-required' };
    if (
      error.subtype === 'invalid_ai_address' ||
      error.subtype === 'ai_credential_in_public_fields'
    ) {
      return { kind: 'invalid-address' };
    }
    if (error.subtype === 'invalid_ai_key') return { kind: 'invalid-key' };
    if (error.subtype === 'invalid_ai_model') return { kind: 'model-not-found' };
  }
  return { kind: 'other-error' };
}
