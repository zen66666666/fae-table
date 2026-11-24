// 生成并核对工作台允许的审批写命令，仅供单据写入器使用。
import {
  AppError,
  normalizeTicketWriteText,
  TICKET_ID_PATTERN,
  TICKET_WRITE_TEXT_LIMIT,
} from '../../core/src/index.ts';
import type { TicketWriteAction } from '../../core/src/index.ts';

const TASK_ID = /^[1-9]\d{0,15}$/u;
const PROFILE_SEPARATORS = /[,\u0000-\u001f\u007f-\u009f]/u;
const OA_PREFIX = ['oa', 'approval'] as const;
const WRITE_COMMANDS: Record<TicketWriteAction, string> = {
  approve: 'approve',
  reject: 'reject',
  comment: 'oa-comments',
};
const WRITE_PATHS = new Set(
  Object.values(WRITE_COMMANDS).map((leaf) => [...OA_PREFIX, leaf].join(' ')),
);

/** 写命令使用的已核实上下文；实例、账号和待办任务不从正文读取。 */
export type ApprovalWriteScope = {
  id: string;
  action: TicketWriteAction;
  text: string;
  profile: string;
  taskId: string | null;
};

/**
 * 将钉钉返回的任务 ID 转成十进制参数。
 * @param value 当前账号的只读待办任务返回值。
 * @returns 正安全整数的字符串；其余返回 null。
 * @throws 无预期错误。
 */
export function readApprovalTaskId(value: unknown): string | null {
  const text = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  // 钉钉 CLI 将参数解析成浮点数，拒绝会被四舍五入到其他任务的编号。
  return TASK_ID.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

/**
 * 校验显式选中的单一钉钉账号。
 * @param profile 已交叉核实的 CLI 账号。
 * @returns 参数必须非空、不以选项开头且不能包含分隔符。
 * @throws 无预期错误。
 */
export function isApprovalProfile(profile: string): boolean {
  return Boolean(profile.trim()) && !profile.startsWith('-') && !PROFILE_SEPARATORS.test(profile);
}

/**
 * 判断 CLI 路径是否是工作台允许的写操作。
 * @param operation 由专用白名单验证后的命令路径。
 * @returns 匹配时为 true。
 * @throws 无预期错误。
 */
export function isApprovalWritePath(operation: string): boolean {
  return WRITE_PATHS.has(operation);
}

function failPolicy(): never {
  throw new AppError('policy', 'approval_write_not_allowed', 'approval-write');
}

/**
 * 按固定顺序生成一条审批写命令，文本只占参数数组的一项。
 * @param scope 已核实的实例、任务、账号及与用户确认一致的意见。
 * @returns 精确的 CLI 参数数组和命令路径。
 * @throws AppError 内容不规范或上下文不符合写白名单。
 */
export function buildApprovalWrite(scope: ApprovalWriteScope): { argv: string[]; path: string } {
  // 1. 验证固定范围与已确认文字。2. 生成所选命令及其唯一允许的选项。
  const { id, action, profile, text, taskId } = scope;
  if (
    !TICKET_ID_PATTERN.test(id) ||
    !isApprovalProfile(profile) ||
    !Object.hasOwn(WRITE_COMMANDS, action) ||
    text.length > TICKET_WRITE_TEXT_LIMIT ||
    normalizeTicketWriteText(text) !== text ||
    (action !== 'approve' && !text)
  )
    failPolicy(); // 1.
  const leaf = WRITE_COMMANDS[action];
  const argv = [...OA_PREFIX, leaf, '--instance-id', id];
  const suffix = ['--profile', profile, '--yes', '-f', 'json'];
  if (action === 'comment') {
    if (taskId !== null) failPolicy();
    return { argv: [...argv, '--content', text, ...suffix], path: [...OA_PREFIX, leaf].join(' ') };
  }
  if (taskId === null || readApprovalTaskId(taskId) !== taskId) failPolicy();
  argv.push('--task-id', taskId); // 2.
  if (text) argv.push('--remark', text);
  return { argv: [...argv, ...suffix], path: [...OA_PREFIX, leaf].join(' ') };
}

function checkExactArguments(actual: readonly string[], expected: readonly string[]): void {
  // 逐位置检查。意见即使长得像 --flag，也始终是选项的单个值，不经过 shell 或二次拆词。
  if (actual.length !== expected.length || expected.some((value, index) => actual[index] !== value))
    failPolicy();
}

/**
 * 校验完整写命令，包括参数顺序和值必须与本次已核实的范围完全一致。
 * @param argv 即将启动时使用的参数数组。
 * @param scope 对本次操作已独立核验的上下文。
 * @returns 验证通过的命令路径；不能作为通用读命令使用。
 * @throws AppError 存在多余参数、换了账号或修改了已确认文字。
 */
export function validateApprovalWrite(
  argv: readonly string[],
  scope: ApprovalWriteScope,
): { path: string } {
  const expected = buildApprovalWrite(scope);
  checkExactArguments(argv, expected.argv);
  return { path: expected.path };
}
