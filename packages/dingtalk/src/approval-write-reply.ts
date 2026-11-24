// 将审批写入的 CLI 响应解释为私有的固定结果，供钉钉执行器使用。
import { asObject, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import type { RunnerResult } from './runner-types.ts';

const ERROR_FIELDS = ['errcode', 'errorCode', 'error_code', 'dingOpenErrcode'] as const;
const PERMISSION_CODES = new Set([
  '403',
  'access_denied',
  'accessdenied',
  'authorization',
  'forbidden',
  'insufficient_scope',
  'no_permission',
  'nopermission',
  'permission',
  'permission_denied',
  'permissiondenied',
  'no_permission_to_operate',
  'nopermissiontooperate',
]);
const FAILED_OUTCOMES = new Set(['failure', 'failed', 'error', 'partial', 'blocked']);
const SUCCESS_OUTCOMES = new Set(['success', 'succeeded', 'ok']);

function readStatusSymbol(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().toLowerCase()
    : '';
}

function isPermissionCode(value: unknown): boolean {
  const code = readStatusSymbol(value);
  return (
    PERMISSION_CODES.has(code) || code.startsWith('forbidden.') || code.startsWith('accessdenied.')
  );
}

function isZeroCode(value: unknown): boolean {
  return value === 0 || value === '0';
}

function getReplyObjects(data: JsonObject): JsonObject[] {
  return [data, asObject(data.result), asObject(data.data)];
}

function hasPermissionFailure(data: JsonObject): boolean {
  return getReplyObjects(data).some((part) => {
    const error = asObject(part.error);
    return [
      error.type,
      error.subtype,
      error.code,
      error.status,
      error.statusCode,
      part.code,
      part.statusCode,
      ...ERROR_FIELDS.map((key) => part[key]),
    ].some(isPermissionCode);
  });
}

function hasDeclaredFailure(part: JsonObject): boolean {
  return (
    part.ok === false ||
    part.success === false ||
    (part.error !== undefined && part.error !== null && part.error !== '') ||
    part.result === false ||
    part.result === 'false' ||
    part.data === false ||
    part.data === 'false' ||
    FAILED_OUTCOMES.has(readStatusSymbol(part.outcome)) ||
    ERROR_FIELDS.some(
      (key) => part[key] !== undefined && part[key] !== null && !isZeroCode(part[key]),
    )
  );
}

/**
 * 只识别可以从 stderr 读取的明确审批失败。
 * @param data 待检查的错误封装。
 * @returns 存在固定失败类别时为 true。
 * @throws 无预期错误。
 */
export function hasApprovalReplyFailure(data: JsonObject): boolean {
  return hasPermissionFailure(data) || getReplyObjects(data).some(hasDeclaredFailure);
}

/**
 * 判定审批命令是否得到明确成功答复，否则交给调用方核实结果。
 * @param options 已解析的 CLI 封装、退出码和经专用策略验证的操作。
 * @returns 仅固定失败类别；成功的数据只交给模块内部的读取步骤。
 * @throws 无预期错误。
 */
export function classifyApprovalReply(options: {
  data: unknown;
  exitCode: number | null;
  operation: string;
}): RunnerResult {
  const { data, exitCode, operation } = options;
  const fail = (subtype: string, type = 'protocol'): RunnerResult => ({
    kind: 'failure',
    exitCode,
    error: { type, subtype, operation },
  });
  if (!isObject(data)) return fail('invalid_approval_reply');
  if (hasPermissionFailure(data)) return fail('approval_permission', 'permission');
  if (exitCode !== 0) return fail('approval_exit', 'process');
  if (hasApprovalReplyFailure(data)) return fail('approval_rejected');
  if (
    ['ok', 'success'].some((key) => Object.hasOwn(data, key) && typeof data[key] !== 'boolean') ||
    (Object.hasOwn(data, 'outcome') && typeof data.outcome !== 'string')
  )
    return fail('invalid_approval_status');
  const outcome = readStatusSymbol(data.outcome);
  // 旧版直接输出钉钉封装；新版用 ok 标记成功。不能只根据退出码为零判定写入完成。
  const isModern = data.ok === true && (outcome === '' || SUCCESS_OUTCOMES.has(outcome));
  const isLegacy =
    data.success === true &&
    (ERROR_FIELDS.some((key) => isZeroCode(data[key])) || data.result === true);
  if (!isModern && !isLegacy) return fail('unconfirmed_approval_reply');
  return { kind: 'success', data, exitCode };
}
