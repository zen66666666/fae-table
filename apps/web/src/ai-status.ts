// 将 AI 配置和测试结果映射为通用连接标签，供设置卡片与工作台状态栏共用。
import type { AiStatus, ConnectionState } from '../../../packages/core/src/index.ts';

/**
 * 根据配置是否保存和最近一次测试结果生成连接标签。
 * @param status 仅含可公开状态的 AI 接口摘要。
 * @returns 通用连接状态。
 * @throws 无预期错误。
 */
export function getAiConnectionState(status: AiStatus | null): ConnectionState {
  if (!status) return 'unchecked';
  if (!status.isConfigured) return 'action-required';
  if (!status.lastTest) return 'unchecked';
  return status.lastTest.kind === 'available' ? 'ready' : 'failed';
}
