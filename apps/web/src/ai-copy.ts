// 集中维护 AI 接口配置和测试文案，供设置向导与 AI 卡片使用。
import { AI_MODEL_LIMIT } from '../../../packages/core/src/index.ts';
import type { AiModelsResult, AiTestResult } from '../../../packages/core/src/index.ts';

/** AI 接口表单的统一中文文案。 */
export const AI_COPY = {
  title: 'AI 接口',
  description: '填写 OpenAI 兼容接口地址和 API Key，再获取可用模型。',
  address: '接口地址',
  addressExample: 'https://example.com/v1',
  model: '模型名称',
  currentModel: '当前模型',
  fetchModels: '获取模型',
  refreshModels: '刷新列表',
  fetchingModels: '正在获取…',
  chooseModel: '请选择模型',
  noModels: '这个服务没有返回可用模型',
  fetchModelsFailed: '未能获取模型列表',
  truncatedModels: `名单只显示前 ${AI_MODEL_LIMIT} 个模型。手动填写后，需要测试连接。`,
  truncatedWorkbenchModels: `列表过长，只显示前 ${AI_MODEL_LIMIT} 个，其余可在连接设置中手动填写`,
  manualModel: '手动填写模型名称',
  changeModelInSettings: '在连接设置中修改',
  key: 'API Key',
  keySaved: '已保存',
  keySuffix: '末 4 位',
  changeKey: '更换 Key',
  cancelKeyChange: '保留原 Key',
  changedServer: '更换了接口服务器，请重新填写 API Key',
  unencrypted: '这个地址不加密',
  test: '测试连接',
  testing: '正在测试…',
  notTested: '尚未测试',
  save: '保存设置',
  clear: '清除配置',
  testResult: '测试结果',
} as const;

/** 将后台的安全结果分类映射为固定文案，不使用接口的原始内容。 */
export const AI_TEST_LABELS: Record<AiTestResult['kind'], string> = {
  available: '可用',
  'invalid-key': 'Key 无效',
  'invalid-address': '地址不对或连不上',
  'model-not-found': '模型不存在',
  timeout: '超时',
  'key-required': AI_COPY.changedServer,
  'other-error': '其他错误',
};

/** 模型列表请求的安全提示；成功后由模型选择器展示结果。 */
export const AI_MODEL_MESSAGES: Record<Exclude<AiModelsResult['kind'], 'available'>, string> = {
  'invalid-key': AI_TEST_LABELS['invalid-key'],
  'invalid-address': AI_TEST_LABELS['invalid-address'],
  timeout: AI_TEST_LABELS.timeout,
  'key-required': AI_TEST_LABELS['key-required'],
  unsupported: '这个服务不提供模型列表',
};

/**
 * 将模型刷新结果映射为简短提示，已有可选项时不增加额外说明。
 * @param result 后台过滤的模型列表及固定类别。
 * @returns 可显示的失败或空列表提示，成功有列表时为空。
 * @throws 无预期错误。
 */
export function getAiModelsMessage(result: AiModelsResult): string {
  return result.kind === 'available'
    ? result.models.length
      ? ''
      : AI_COPY.noModels
    : AI_MODEL_MESSAGES[result.kind];
}
