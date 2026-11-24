// 为只读探针和工作台共享审批模板识别、查询参数及当前处理人判断。
import { AppError, isObject } from '../../core/src/index.ts';
import type { JsonObject, TicketSource } from '../../core/src/index.ts';
import { TEMPLATE_NAMES } from './readonly-summary.ts';
import {
  APPROVAL_EXECUTED_COMMAND,
  APPROVAL_EXECUTED_STATUS,
  APPROVAL_EXECUTED_STATUS_FLAG,
} from './command-policy.ts';
import { isCompleteDingtalkResult, mustSucceed } from './common.ts';
import type { Run } from './common.ts';
import { parseDetailPayload } from './readonly-payload.ts';
import type { RunnerResult } from './runner-types.ts';

const EXECUTION_FAILURES = new Set(['timeout', 'aborted', 'spawn_failed', 'output_limit']);

/**
 * 按已有模板名称规则识别支持流程，绝不根据固定 processCode 匹配。
 * @param item 列表返回的实例对象。
 * @returns 命中的支持模板名；未知模板返回 undefined。
 * @throws 不抛出预期错误。
 */
export function findSupportTemplate(item: JsonObject): string | undefined {
  return TEMPLATE_NAMES.find(
    (name) =>
      item.processName === name ||
      item.templateName === name ||
      item.title === name ||
      (typeof item.title === 'string' && item.title.endsWith(`提交的${name}`)),
  );
}

function formatQueryDate(time: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    // 钉钉列表的日期参数未声明时区，沿用运行机器的本地时区。
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(time);
}

/** 审批列表查询参数；时间为毫秒，页码和页大小由调用方设置上限。 */
export type ApprovalListQuery = {
  source: TicketSource;
  start: number;
  end: number;
  profile: string;
  page: number;
  pageSize: number;
};

/**
 * 生成各类列表接受的固定命令，供参数构造和失败诊断复用。
 * @param source 工作台允许读取的来源。
 * @returns 固定的只读命令词。
 * @throws 无预期错误。
 */
export function getApprovalListCommand(source: TicketSource): readonly string[] {
  return source === 'executed' ? APPROVAL_EXECUTED_COMMAND : ['oa', `+list-${source}`];
}

/**
 * 生成各类列表接受的固定参数，供探针和工作台复用。
 * @param options 已核实身份、查询范围和分页信息。
 * @returns 交给白名单 runner 的参数数组。
 * @throws 时间范围不可格式化时抛出 RangeError，后续参数仍由白名单校验。
 * 步骤：1. 转换日期范围；2. 添加来源过滤和公共参数。
 */
export function buildApprovalListArguments(options: ApprovalListQuery): string[] {
  // 1. 待处理使用 epoch 毫秒，其他来源使用本机日期。
  const range =
    options.source === 'pending'
      ? ['--start', String(options.start), '--end', String(options.end)]
      : [
          '--create-time-from',
          formatQueryDate(options.start),
          '--create-time-to',
          formatQueryDate(options.end),
        ];
  // 2. 我已处理只跟进进行中的审批，其他来源维持原有查询范围。
  const status =
    options.source === 'executed' ? [APPROVAL_EXECUTED_STATUS_FLAG, APPROVAL_EXECUTED_STATUS] : [];
  return [
    ...getApprovalListCommand(options.source),
    ...range,
    ...status,
    '--page',
    String(options.page),
    '--limit',
    String(options.pageSize),
    '--profile',
    options.profile,
    '-f',
    'json',
  ];
}

/**
 * 仅用运行中的任务判断当前用户是不是处理人。
 * @param tasks 接口给出的任务集合，缺少集合时返回 null。
 * @param userId 已核实的当前用户标识。
 * @returns 存在当前运行任务时为 true，已知集合无匹配时为 false，未知集合为 null。
 * @throws 不抛出预期错误。
 */
export function isCurrentTaskActor(tasks: unknown, userId: string): boolean | null {
  if (!Array.isArray(tasks)) return null;
  // 已完成的历史任务不赋予当前处理身份，不能只比较 userId。
  return tasks.some(
    (task) => isObject(task) && task.taskStatus === 'RUNNING' && task.userId === userId,
  );
}

/** 审批详情类读取参数；leaf 只能选择现有三个白名单查询。 */
export type ApprovalPayloadQuery = {
  run: Run;
  leaf: 'detail' | 'records' | 'tasks';
  instanceId: string;
  profile: string;
};

function didApprovalExitAbnormally(result: RunnerResult): boolean {
  if (result.kind === 'success' || result.exitCode === 0) return false;
  // 没有结构化输出且退出非零时，退出问题先于格式问题；保留已有的安全执行原因。
  if (result.kind === 'unparseable') return true;
  return (
    result.exitCode !== null &&
    result.error?.type === 'process' &&
    !EXECUTION_FAILURES.has(result.error.subtype)
  );
}

async function readApprovalEnvelope(options: ApprovalPayloadQuery): Promise<JsonObject> {
  const result = await options.run([
    'oa',
    'approval',
    options.leaf,
    '--instance-id',
    options.instanceId,
    '--profile',
    options.profile,
    '-f',
    'json',
  ]);
  // 权限等明确的 CLI 失败仍按原业务原因处理。
  if (didApprovalExitAbnormally(result)) {
    throw new AppError('process', 'nonzero_exit', options.leaf);
  }
  return mustSucceed(result, `oa approval ${options.leaf}`);
}

/**
 * 按同一套参数构造和结构校验读取详情、记录或任务，供探针和工作台复用。
 * @param options 固定查询类别、已核实账号和已校验实例标识。
 * @returns 通过既有返回判定与详情结构校验的对象。
 * @throws AppError 命令失败或返回结构与实例不匹配时抛出。
 */
export async function readApprovalPayload(options: ApprovalPayloadQuery): Promise<JsonObject> {
  const envelope = await readApprovalEnvelope(options);
  const payload = parseDetailPayload(envelope, options.leaf, options.instanceId);
  // 外层的分页或截断标记也会影响记录完整性，详情仍可显示已读取的部分。
  return isCompleteDingtalkResult(envelope) ? payload : { ...payload, complete: false };
}
