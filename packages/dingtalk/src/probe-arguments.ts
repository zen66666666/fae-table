// 解析只读和事件探针参数，限制查询数量、观察时长和身份选择。
import { AppError } from '../../core/src/index.ts';

function parseValues(args: string[], mode: 'readonly' | 'event'): Record<string, string> {
  const values: Record<string, string> = {};
  const allowed = new Set(
    mode === 'readonly'
      ? ['days', 'page-size', 'max-pages', 'sample', 'profile']
      : ['seconds', 'profile'],
  );
  for (let index = 0; index < args.length; index++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[index]);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(values, match[1])) {
      throw new AppError('validation', 'invalid_argument', 'arguments');
    }
    const value = match[2] ?? args[++index];
    if (typeof value !== 'string' || !value || value.startsWith('--') || value.includes('\0')) {
      throw new AppError('validation', 'missing_value', 'arguments');
    }
    values[match[1]] = value;
  }
  return values;
}

function parseInteger(values: Record<string, string>, name: string, fallback: number, max: number) {
  if (!Object.hasOwn(values, name)) return fallback;
  if (!/^\d+$/.test(values[name])) {
    throw new AppError('validation', 'invalid_number', 'arguments');
  }
  const value = Number(values[name]);
  // 参数必须有上限，避免探针意外执行无界分页或长时间订阅。
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new AppError('validation', 'invalid_number', 'arguments');
  }
  return value;
}

/**
 * 解析探针参数，并按原有规则应用默认值和环境身份。
 * @param args 不含 Node 入口路径的命令行参数。
 * @param mode 只读查询或事件订阅模式。
 * @returns 经校验的身份、查询范围、分页及观察时长参数。
 * @throws AppError：参数未知、重复、缺值、超出范围或身份格式无效。
 */
export function parseArguments(args: string[], mode: 'readonly' | 'event') {
  const values = parseValues(args, mode);
  const profile = values.profile ?? process.env.FAE_DWS_PROFILE;
  // 一次只选一个身份，避免多组织查询混合后错误归属当前用户。
  if (
    profile !== undefined &&
    (!profile.trim() || profile.includes(',') || profile.includes('\0'))
  ) {
    throw new AppError('identity', 'invalid_profile', 'arguments');
  }
  return {
    profile,
    days: parseInteger(values, 'days', 30, 366),
    pageSize: parseInteger(values, 'page-size', 20, 100),
    maxPages: parseInteger(values, 'max-pages', 5, 100),
    sample: parseInteger(values, 'sample', 1, 20),
    seconds: parseInteger(values, 'seconds', 60, 3600),
  };
}
