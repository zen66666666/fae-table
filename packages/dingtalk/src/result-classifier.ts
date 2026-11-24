// 按已确认的 CLI 返回契约判定成功、失败和不可解析结果。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import type { RunnerResult } from './runner-types.ts';
import { CONTACT_NAME_COMMAND } from './contact-policy.ts';
import { APPROVAL_EXECUTED_PATH, CODETABLE_SEARCH_PATH } from './command-policy.ts';
import { hasValidMemberNamesPayload } from './member-names.ts';
import { classifyApprovalReply, hasApprovalReplyFailure } from './approval-write-reply.ts';
import { isApprovalWritePath } from './approval-write-policy.ts';

function sanitizeSymbol(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:/+ -]{1,160}$/.test(value) ? value : fallback;
}

function hasValidProfiles(data: JsonObject): boolean {
  return (
    typeof data.currentProfile === 'string' &&
    Array.isArray(data.profiles) &&
    data.profiles.every(
      (profile) =>
        isObject(profile) &&
        typeof profile.profile === 'string' &&
        typeof profile.corpId === 'string' &&
        typeof profile.userId === 'string',
    )
  );
}

function hasValidEventStatus(data: JsonObject): boolean {
  return (
    isObject(data.bus) &&
    isObject(data.identity) &&
    typeof data.identity.identity_hash === 'string' &&
    typeof data.identity.corp_id === 'string' &&
    typeof data.identity.user_id === 'string' &&
    Array.isArray(data.subscriptions) &&
    data.subscriptions.every(isObject)
  );
}

function hasValidInstanceList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (instance) =>
        isObject(instance) &&
        typeof instance.processInstanceId === 'string' &&
        instance.processInstanceId.length > 0,
    )
  );
}

function hasValidOperationPayload(data: JsonObject, operation: string): boolean {
  const result = isObject(data.result) ? data.result : {};
  switch (operation) {
    case CODETABLE_SEARCH_PATH:
      return Array.isArray(data.files);
    case CONTACT_NAME_COMMAND:
      return hasValidMemberNamesPayload(data);
    case 'auth status':
      return typeof data.authenticated === 'boolean';
    case 'profile list':
      return hasValidProfiles(data);
    case 'oa +list-pending':
    case 'oa +list-cc':
      return isObject(data.data) && hasValidInstanceList(data.data.instances);
    case APPROVAL_EXECUTED_PATH:
      return (
        data.success === true &&
        data.dingOpenErrcode === 0 &&
        typeof result.hasMore === 'boolean' &&
        hasValidInstanceList(result.values)
      );
    case 'oa approval detail':
      return typeof result.processInstanceId === 'string' && result.processInstanceId.length > 0;
    case 'oa approval records':
      return (
        Array.isArray(result.operationRecords) &&
        result.operationRecords.every(isObject) &&
        typeof result.processInstanceId === 'string'
      );
    case 'oa approval tasks':
      return (
        Array.isArray(result.taskIdList) &&
        result.taskIdList.every(
          (task) =>
            isObject(task) && (typeof task.taskId === 'string' || typeof task.taskId === 'number'),
        )
      );
    case 'event status':
      return hasValidEventStatus(data);
    // 事件目录原生返回数组，单独按数组契约校验。
    case 'event list':
      return false;
    default:
      return true;
  }
}

function hasReportedFailure(data: JsonObject): boolean {
  return (
    data.ok === false ||
    data.success === false ||
    isObject(data.error) ||
    ['errcode', 'errorCode', 'error_code'].some(
      (key) =>
        data[key] !== undefined && data[key] !== null && data[key] !== 0 && data[key] !== '0',
    ) ||
    (typeof data.outcome === 'string' &&
      ['failure', 'failed', 'error', 'partial', 'blocked'].includes(data.outcome.toLowerCase()))
  );
}

function parseEnvelope(options: { stdout: string; stderr: string; isApproval: boolean }): unknown {
  const { stdout, stderr, isApproval } = options;
  try {
    return JSON.parse(stdout);
  } catch {
    // stderr 只接受结构化失败；不能将任意诊断文本当成成功结果。
    try {
      const candidate: unknown = JSON.parse(stderr);
      if (
        isObject(candidate) &&
        (isApproval ? hasApprovalReplyFailure(candidate) : hasReportedFailure(candidate))
      )
        return candidate;
    } catch {
      // 原始输出由执行层落盘，无法解析的返回不能视为空结果。
    }
  }
  return undefined;
}

function isEventCatalog(data: unknown): boolean {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        isObject(item) &&
        typeof item.event_key === 'string' &&
        /^user_oa_approval_[a-z_]+$/.test(item.event_key) &&
        item.category === 'oa' &&
        typeof item.display_name === 'string' &&
        typeof item.status === 'string',
    )
  );
}

function hasInvalidStatus(data: JsonObject): boolean {
  return (
    (Object.hasOwn(data, 'outcome') && typeof data.outcome !== 'string') ||
    (Object.hasOwn(data, 'ok') && typeof data.ok !== 'boolean') ||
    (Object.hasOwn(data, 'success') && typeof data.success !== 'boolean')
  );
}

function isLegacySuccess(data: JsonObject, operation: string, outcome: string): boolean {
  if (data.ok !== undefined || outcome !== '') return false;
  // 仅接受已核对的旧版封装，不能把快捷查询等其他封装套用到这些规则。
  switch (operation) {
    case CODETABLE_SEARCH_PATH:
      return hasValidOperationPayload(data, operation);
    case CONTACT_NAME_COMMAND:
      return data.success === true && hasValidMemberNamesPayload(data);
    case 'auth status':
      return data.success === true && typeof data.authenticated === 'boolean';
    case 'profile list':
      return data.success === true && hasValidProfiles(data);
    case 'event status':
      return hasValidEventStatus(data);
    case APPROVAL_EXECUTED_PATH:
      // 原生命令没有快捷查询的统一外层，只接受已经确认的成功结构。
      return hasValidOperationPayload(data, operation);
    case 'oa approval detail':
      return (
        data.success === true && data.errcode === 0 && hasValidOperationPayload(data, operation)
      );
    case 'oa approval records':
    case 'oa approval tasks':
      return (
        data.success === true && data.errorCode === 0 && hasValidOperationPayload(data, operation)
      );
    default:
      return false;
  }
}

function buildFailure(
  exitCode: number | null,
  operation: string,
  type: string,
  subtype: string,
  kind: RunnerResult['kind'] = 'failure',
): RunnerResult {
  return { kind, exitCode, error: { type, subtype, operation } };
}

function classifyEnvelope(
  data: JsonObject,
  exitCode: number | null,
  operation: string,
): RunnerResult {
  const outcome = typeof data.outcome === 'string' ? data.outcome.toLowerCase() : '';
  if (exitCode !== 0 || hasReportedFailure(data)) {
    const error = isObject(data.error) ? data.error : {};
    return buildFailure(
      exitCode,
      sanitizeSymbol(error.operation, operation),
      sanitizeSymbol(error.type, 'process'),
      sanitizeSymbol(error.subtype, exitCode === 0 ? 'cli_failure' : 'nonzero_exit'),
    );
  }
  if (hasInvalidStatus(data))
    return buildFailure(exitCode, operation, 'structure', 'invalid_status_fields');
  if (data.ok === true && (outcome === '' || ['success', 'succeeded', 'ok'].includes(outcome))) {
    if (!hasValidOperationPayload(data, operation))
      return buildFailure(exitCode, operation, 'structure', 'invalid_payload');
    return { kind: 'success', exitCode, data };
  }
  if (isLegacySuccess(data, operation, outcome)) return { kind: 'success', exitCode, data };
  return buildFailure(exitCode, operation, 'protocol', 'unknown_envelope', 'unparseable');
}

/**
 * 判定命令结果，错误对象不包含原始 stdout 或 stderr。
 * @param stdout 标准输出文本。
 * @param stderr 标准错误文本，只尝试读取结构化失败。
 * @param exitCode 进程退出码，未正常退出时为 null。
 * @param operation 已校验的命令路径。
 * @returns 完整成功封装或脱敏的失败、解析错误；解析失败不抛错。
 */
export function classifyResult(
  stdout: string,
  stderr: string,
  exitCode: number | null,
  operation: string,
): RunnerResult {
  const isApproval = isApprovalWritePath(operation);
  const data = parseEnvelope({ stdout, stderr, isApproval });
  if (isApproval) return classifyApprovalReply({ data, exitCode, operation });
  if (operation === 'event list' && isEventCatalog(data)) {
    return exitCode === 0
      ? { kind: 'success', exitCode, data }
      : buildFailure(exitCode, operation, 'process', 'nonzero_exit');
  }
  if (!isObject(data))
    return buildFailure(exitCode, operation, 'protocol', 'invalid_json', 'unparseable');
  return classifyEnvelope(data, exitCode, operation);
}
