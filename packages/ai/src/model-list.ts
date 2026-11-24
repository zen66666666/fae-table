// 过滤模型名称并读取已保存的列表与时间，供 AI 探测和普通配置存储使用。
import { AI_MODEL_LIMIT, isAiModel } from '../../core/src/index.ts';
import type { AiStatus, JsonObject } from '../../core/src/index.ts';
import { hasAiKeyText } from './config-input.ts';

/** 同一次成功获取的模型名称与时间，应一起提交或废弃。 */
export type AiModelList = Required<Pick<AiStatus, 'models' | 'modelsFetchedAt'>> &
  Pick<AiStatus, 'isModelListTruncated'>;

/**
 * 从上游或本机配置中读取可公开的精确模型名称，保留原值并去重。
 * @param values 未经校验的名称。
 * @param apiKey 上游请求使用的凭据；读取本机配置时省略。
 * @returns 已过滤的名称集合，不截断，便于连通测试核对旧模型。
 * @throws 无预期错误。
 */
export function readUniqueAiModels(values: Iterable<unknown>, apiKey?: string): string[] {
  const models = new Set<string>();
  for (const model of values) {
    // 上游响应不可信，不能借模型名称回显请求使用的 Key。
    if (isAiModel(model) && (apiKey === undefined || !hasAiKeyText(model, apiKey)))
      models.add(model);
  }
  return [...models];
}

/**
 * 解析旧版或新版配置中的可选模型名单，名单和获取时间须同时有效。
 * @param value 已解析的普通配置字段。
 * @returns 经过筛选与数量限制的快照；旧配置或无效快照返回 undefined。
 * @throws 无预期错误。
 */
export function readStoredAiModelList(value: JsonObject): AiModelList | undefined {
  const { models, modelsFetchedAt, isModelListTruncated } = value;
  if (!Array.isArray(models) || typeof modelsFetchedAt !== 'string') return;
  const fetchedAt = Date.parse(modelsFetchedAt);
  if (!Number.isFinite(fetchedAt)) return;
  const unique = readUniqueAiModels(models).sort();
  // 旧版普通配置可能保留了 500 项以上的名单，读入时补齐截断标记。
  return {
    models: unique.slice(0, AI_MODEL_LIMIT),
    modelsFetchedAt: new Date(fetchedAt).toISOString(),
    ...(isModelListTruncated === true || unique.length > AI_MODEL_LIMIT
      ? { isModelListTruncated: true }
      : {}),
  };
}
