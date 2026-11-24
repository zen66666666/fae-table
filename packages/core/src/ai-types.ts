// 为后台和浏览器提供 AI 接口配置和测试的共用契约。

/** AI 接口的受会话保护的本机 API 路径。 */
export const AI_ROUTES = {
  status: '/api/ai/status',
  config: '/api/ai/config',
  models: '/api/ai/models',
  refreshModels: '/api/ai/models/refresh',
  switchModel: '/api/ai/model',
  test: '/api/ai/test',
  clear: '/api/ai/clear',
} as const;

/** 连通测试只公开固定结果，避免透传服务响应和错误详情。 */
export const AI_TEST_KINDS = [
  'available',
  'invalid-key',
  'key-required',
  'invalid-address',
  'model-not-found',
  'timeout',
  'other-error',
] as const;

/** 获取模型所需的接口地址和 Key；同源时允许空 Key。 */
export type AiModelsInput = { address: string; apiKey: string };

/** 模型列表最多保存和展示的项目数。 */
export const AI_MODEL_LIMIT = 500;

const AI_MODEL_MAX_LENGTH = 512;

/**
 * 验证可从服务端接收、持久化及选择的模型名称。
 * @param value 来自网页、上游列表或本机记录的未知值。
 * @returns 有非空白内容、未超长且不包含控制字符时为 true。
 * @throws 无预期错误；不改写模型名称，保证列表按原值精确匹配。
 */
export function isAiModel(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= AI_MODEL_MAX_LENGTH &&
    !/[\x00-\x1f\x7f-\x9f]/u.test(value)
  );
}

/** 获取模型的固定结果及已过滤的模型名，超过列表上限时标识截断。 */
export type AiModelsResult = {
  kind:
    | 'available'
    | 'invalid-key'
    | 'invalid-address'
    | 'timeout'
    | 'unsupported'
    | 'key-required';
  models: string[];
  isTruncated?: boolean;
};

/** 保存或测试的表单值；空 Key 仅允许沿用同源接口的已保存 Key。 */
export type AiConfigInput = AiModelsInput & { model: string };

/** 连通测试的安全结果，供界面映射到对应文案。 */
export type AiTestResult = { kind: (typeof AI_TEST_KINDS)[number] };

/** AI 接口的公开状态，只含当前配置和能够安全展示的 Key 后缀。 */
export type AiStatus = {
  isConfigured: boolean;
  address: string;
  model: string;
  keyLastFour: string;
  lastTest: AiTestResult | null;
  /** 当前已保存接口的可选模型名单及成功获取时间。 */
  models?: string[];
  modelsFetchedAt?: string;
  /** 最近一次成功的名单超过展示上限时为真。 */
  isModelListTruncated?: true;
  /** 后台另有任何单据正在生成时，禁用工作台的模型切换。 */
  isAnswering?: boolean;
};

/** 用已保存凭据刷新模型后的探测结论和当前安全状态。 */
export type AiModelRefreshResult = { status: AiStatus; result: AiModelsResult };
