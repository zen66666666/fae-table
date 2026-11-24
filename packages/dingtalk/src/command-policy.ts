// 为普通读取与编号表专用流程校验各自的钉钉命令白名单。
import { isApprovalProfile } from './approval-write-policy.ts';
import { CONTACT_NAME_COMMAND, hasValidContactIds } from './contact-policy.ts';

/** 我已处理列表只读取当前账号的审批实例。 */
export const APPROVAL_EXECUTED_COMMAND = ['oa', 'approval', 'list-executed'] as const;
/** 我已处理列表的固定命令名称，用于读取和结构校验。 */
export const APPROVAL_EXECUTED_PATH = APPROVAL_EXECUTED_COMMAND.join(' ');
/** 我已处理列表单次允许的最大页大小。 */
export const APPROVAL_EXECUTED_PAGE_LIMIT = 100;
/** 我已处理列表用于限制流程状态的参数。 */
export const APPROVAL_EXECUTED_STATUS_FLAG = '--process-instance-status';
/** 我已处理列表只跟进尚未结束的流程。 */
export const APPROVAL_EXECUTED_STATUS = 'RUNNING';
/** 钉盘只允许使用这个固定的编号表搜索词。 */
export const CODETABLE_SEARCH_QUERY = '软件源码编号管理表';
/** 下载写入临时工作目录下这个固定的文件名。 */
export const CODETABLE_FILE_NAME = 'codetable.xlsx';
/** 编号表专用查询使用的命令。 */
export const CODETABLE_SEARCH_COMMAND = ['drive', '+find-file'] as const;
/** 编号表专用下载使用的命令。 */
export const CODETABLE_DOWNLOAD_COMMAND = ['drive', '+download'] as const;
/** 用于编号表搜索的结果分类和错误标记。 */
export const CODETABLE_SEARCH_PATH = CODETABLE_SEARCH_COMMAND.join(' ');
/** 用于编号表下载的结果分类和错误标记。 */
export const CODETABLE_DOWNLOAD_PATH = CODETABLE_DOWNLOAD_COMMAND.join(' ');

const EVENT_KEYS = new Set([
  'user_oa_approval_task_created',
  'user_oa_approval_task_finished',
  'user_oa_approval_task_redirected',
  'user_oa_approval_instance_cc',
]);
type Specification = { values: string[]; booleans?: string[]; commonValues?: string[] };
const COMMANDS: Record<string, Specification> = {
  'auth status': { values: [], booleans: ['--readonly'] },
  'profile list': { values: [] },
  'oa +list-pending': {
    values: ['--start', '--end', '--page', '--limit', '--query', '--process-code'],
  },
  'oa +list-cc': {
    values: [
      '--create-time-from',
      '--create-time-to',
      '--page',
      '--limit',
      '--query',
      '--process-code',
    ],
  },
  [APPROVAL_EXECUTED_PATH]: {
    values: [
      '--create-time-from',
      '--create-time-to',
      '--page',
      '--limit',
      APPROVAL_EXECUTED_STATUS_FLAG,
    ],
    commonValues: ['--profile', '-f'],
  },
  'oa approval detail': { values: ['--instance-id'] },
  'oa approval records': { values: ['--instance-id'] },
  'oa approval tasks': { values: ['--instance-id'] },
  [CONTACT_NAME_COMMAND]: { values: ['--ids'], commonValues: ['--profile', '-f'] },
  'event list': { values: ['--category'] },
  'event status': { values: ['--status', '--event', '--subscribe-id'] },
  'event consume': { values: ['--duration'], booleans: ['--flatten'] },
};
const CODETABLE_COMMON_VALUES = ['--profile', '--format'];
const CODETABLE_COMMANDS: Record<string, Specification> = {
  [CODETABLE_SEARCH_PATH]: { values: ['--query'], commonValues: CODETABLE_COMMON_VALUES },
  [CODETABLE_DOWNLOAD_PATH]: {
    values: ['--node', '--output'],
    commonValues: CODETABLE_COMMON_VALUES,
  },
};
const CODETABLE_NODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMON_VALUES = ['--profile', '--format', '-f', '--timeout'];
const FORBIDDEN = new Set([
  '--client-id',
  '--client-secret',
  '-y',
  '--yes',
  '--debug',
  '-v',
  '--verbose',
  '--mock',
]);

function rejectCommand(subtype = 'command_not_allowed'): never {
  const error = new Error(`DWS command rejected: ${subtype}`);
  Object.assign(error, { type: 'policy', subtype });
  throw error;
}

function validateTokens(argv: readonly string[], commands: Record<string, Specification>): string {
  if (
    !Array.isArray(argv) ||
    argv.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
  ) {
    rejectCommand('invalid_argv');
  }
  for (const argument of argv) {
    const flag = argument.split('=', 1)[0];
    if (FORBIDDEN.has(flag) || /^-[^-]*[yv]/.test(flag)) rejectCommand('forbidden_flag');
  }
  const command =
    (argv[0] === 'oa' && argv[1] === 'approval') || (argv[0] === 'contact' && argv[1] === 'user')
      ? argv.slice(0, 3).join(' ')
      : argv.slice(0, 2).join(' ');
  // 精确核对命令词，不能让 CLI 通过前缀或额外位置参数选择其他操作。
  if (!Object.hasOwn(commands, command)) rejectCommand();
  if (!command.split(' ').every((part, index) => argv[index] === part))
    rejectCommand('invalid_command_tokens');
  return command;
}

function skipEventKeys(argv: readonly string[], command: string): number {
  let index = command.split(' ').length;
  if (command !== 'event consume') return index;
  const selectedEvents = new Set<string>();
  while (index < argv.length && !argv[index].startsWith('-')) {
    if (!EVENT_KEYS.has(argv[index]) || selectedEvents.has(argv[index]))
      rejectCommand('invalid_event');
    selectedEvents.add(argv[index]);
    index++;
  }
  if (selectedEvents.size === 0) rejectCommand('missing_event');
  return index;
}

function parseFlags(options: {
  argv: readonly string[];
  command: string;
  specification: Specification;
}): Map<string, string> {
  const { argv, command, specification } = options;
  let index = skipEventKeys(argv, command);
  const values = new Map<string, string>();
  while (index < argv.length) {
    const argument = argv[index++];
    const equalIndex = argument.indexOf('=');
    const flag = equalIndex < 0 ? argument : argument.slice(0, equalIndex);
    const canonical = flag === '-f' ? '--format' : flag;
    if (values.has(canonical)) rejectCommand('duplicate_flag');
    if (specification.booleans?.includes(flag)) {
      if (equalIndex >= 0 && argument.slice(equalIndex + 1) !== 'true')
        rejectCommand('invalid_boolean');
      values.set(canonical, 'true');
      continue;
    }
    if (
      !(specification.commonValues ?? COMMON_VALUES).includes(flag) &&
      !specification.values.includes(flag)
    )
      rejectCommand('unexpected_argument');
    const value = equalIndex < 0 ? argv[index++] : argument.slice(equalIndex + 1);
    if (value === undefined || value === '' || value.startsWith('-'))
      rejectCommand('missing_or_flag_value');
    values.set(canonical, value);
  }
  return values;
}

function isCalendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPositiveInteger(value: string): boolean {
  return /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value));
}

function validateExecutedFlags(values: Map<string, string>): void {
  const from = values.get('--create-time-from');
  const to = values.get('--create-time-to');
  const page = values.get('--page') ?? '';
  const limit = values.get('--limit') ?? '';
  const profile = values.get('--profile') ?? '';
  // 明确账号、日期和页大小，避免默认范围或额外选项扩大读取。
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to)
    rejectCommand('invalid_executed_date_range');
  if (
    !isPositiveInteger(page) ||
    !isPositiveInteger(limit) ||
    Number(limit) > APPROVAL_EXECUTED_PAGE_LIMIT
  )
    rejectCommand('invalid_executed_page');
  if (!isApprovalProfile(profile) || values.get('--format') !== 'json')
    rejectCommand('invalid_executed_context');
  // 必须明确限制为进行中，否则已结束的历史审批会扩大预读范围。
  if (values.get(APPROVAL_EXECUTED_STATUS_FLAG) !== APPROVAL_EXECUTED_STATUS)
    rejectCommand('invalid_executed_status');
}

function validateFlagValues(command: string, values: Map<string, string>): void {
  if (command === APPROVAL_EXECUTED_PATH) {
    validateExecutedFlags(values);
    return;
  }
  // 通讯录仅用于补齐已知成员的姓名，不能扩展到搜索或修改默认超时等通用能力。
  if (command === CONTACT_NAME_COMMAND && !hasValidContactIds(values.get('--ids')))
    rejectCommand('invalid_contact_ids');
  if (command === 'auth status' && values.get('--readonly') !== 'true')
    rejectCommand('readonly_required');
  const format = values.get('--format');
  if (format !== undefined && format !== (command === 'event consume' ? 'ndjson' : 'json'))
    rejectCommand('invalid_format');
  if (values.has('--profile') && values.get('--profile')!.includes(','))
    rejectCommand('single_profile_required');
  if (values.has('--timeout') && !/^[1-9]\d*$/.test(values.get('--timeout')!))
    rejectCommand('invalid_timeout');
  if (command.startsWith('oa approval') && !values.has('--instance-id'))
    rejectCommand('instance_required');
  if (command === 'event list' && values.get('--category') !== 'oa')
    rejectCommand('oa_category_required');
  if (command === 'event status') {
    if (
      values.has('--status') &&
      !['active', 'paused', 'error', 'deleted', 'all'].includes(values.get('--status')!)
    )
      rejectCommand('invalid_status');
    if (values.has('--event') && !EVENT_KEYS.has(values.get('--event')!))
      rejectCommand('invalid_event');
  }
}

function parseDuration(values: Map<string, string>): number {
  const duration = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(values.get('--duration') || '');
  if (!duration) rejectCommand('duration_required');
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  const durationMs = Number(duration[1]) * units[duration[2]];
  // 强制有界订阅，避免长期占用本机连接。
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 3_600_000)
    rejectCommand('invalid_duration');
  if (values.get('--flatten') !== 'true' || values.get('--format') !== 'ndjson')
    rejectCommand('flatten_ndjson_required');
  return durationMs;
}

/**
 * 校验完整命令参数，返回命令路径及事件持续时间。
 * @param argv 未经 shell 拼接的命令参数。
 * @returns 允许执行的命令路径和可选持续毫秒数。
 * @throws 参数、命令或事件不在白名单时抛出 policy 错误。
 */
export function validateCommand(argv: readonly string[]): { path: string; durationMs?: number } {
  const command = validateTokens(argv, COMMANDS);
  const values = parseFlags({ argv, command, specification: COMMANDS[command] });
  validateFlagValues(command, values);
  return command === 'event consume'
    ? { path: command, durationMs: parseDuration(values) }
    : { path: command };
}

/**
 * 检查编号表搜索返回的节点标识是否可以作为单个 CLI 参数。
 * @param value 搜索记录中的原始 dentryId。
 * @returns 有界的字母、数字、下划线和连字符组成的标识返回 true。
 * @throws 无预期错误。
 */
export function isCodeTableNodeId(value: unknown): value is string {
  return typeof value === 'string' && CODETABLE_NODE_PATTERN.test(value);
}

/**
 * 校验编号表专用命令，确保下载只使用本轮搜索确认的节点和固定相对路径。
 * @param argv 未经 shell 拼接的完整 CLI 参数。
 * @param scope 当前账号与本轮已校验的节点；搜索阶段省略节点。
 * @returns 经校验的命令路径。
 * @throws 参数、阶段、节点或目标路径不符时抛出 policy 错误。
 */
export function validateCodeTableCommand(
  argv: readonly string[],
  scope: { profile: string; dentryId?: string },
): { path: string } {
  const command = validateTokens(argv, CODETABLE_COMMANDS);
  const values = parseFlags({ argv, command, specification: CODETABLE_COMMANDS[command] });
  validateFlagValues(command, values);
  // 两条命令绑定同一账号；精确校验可选项，防止 CLI 回退到默认组织。
  if (values.get('--profile') !== scope.profile || values.get('--format') !== 'json')
    rejectCommand('invalid_codetable_context');
  if (command === CODETABLE_SEARCH_PATH) {
    if (scope.dentryId !== undefined || values.get('--query') !== CODETABLE_SEARCH_QUERY)
      rejectCommand('invalid_codetable_query');
  } else if (
    !isCodeTableNodeId(scope.dentryId) ||
    values.get('--node') !== scope.dentryId ||
    values.get('--output') !== CODETABLE_FILE_NAME
  ) {
    rejectCommand('invalid_codetable_download');
  }
  return { path: command };
}
