// 将钉钉错误映射为共用原因类别，供连接状态和单据读取复用。
import { asObject } from '../../core/src/index.ts';
import type { ConnectionReason } from '../../core/src/index.ts';

const FAILURE_REASONS: Record<string, ConnectionReason> = {
  authentication: 'login-required',
  identity: 'profile-required',
  timeout: 'timeout',
  permission: 'permission',
  authorization: 'permission',
  protocol: 'protocol',
  structure: 'protocol',
  configuration: 'configuration',
  process: 'process',
};

/**
 * 只返回既定原因类别，避免原始 CLI 错误及业务内容泄露到页面。
 * @param error 模块捕获的异常或执行器安全错误。
 * @returns 前后端共用的原因类别。
 * @throws 无；未知错误返回 unknown。
 */
export function classifyDingtalkReason(error: unknown): ConnectionReason {
  const object = asObject(error);
  if (object.type === 'process' && object.subtype === 'timeout') return 'timeout';
  return typeof object.type === 'string' ? (FAILURE_REASONS[object.type] ?? 'unknown') : 'unknown';
}
