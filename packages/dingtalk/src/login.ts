// 提供独立的钉钉登录入口，仅由本机后台在用户点击登录后调用。
import { AppError, isObject, runProcess } from '../../core/src/index.ts';
import type { LoginResult } from '../../core/src/index.ts';
import { resolveExecutable } from './executable.ts';
import {
  CONNECTION_OUTPUT_BYTES,
  LOGIN_ARGUMENTS,
  LOGIN_TIMEOUT_MS,
} from './connection-constants.ts';
import type { LoginDependencies, LoginOptions } from './connection-types.ts';

let isLoginActive = false;
const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

/**
 * 返回当前模块是否已有授权进程，供连接状态卡片展示。
 * @returns 是否正在登录；不抛出错误。
 */
export function isDingtalkLoginActive(): boolean {
  return isLoginActive;
}

/**
 * 校验登录的唯一业务参数，供后台输入校验和登录入口共用。
 * @param options 可选组织 ID；不接受任何额外字段。
 * @returns 校验通过时无返回值，不会启动进程。
 * @throws AppError：输入不是对象、包含多余字段或组织 ID 格式无效。
 */
export function validateLoginOptions(options: LoginOptions): void {
  // 业务输入只接受组织标识；拒绝额外字段，防止将网页输入拼入 CLI 参数。
  if (
    !isObject(options) ||
    Object.keys(options).some((key) => key !== 'profile') ||
    (options.profile !== undefined &&
      (typeof options.profile !== 'string' || !ORGANIZATION_ID_PATTERN.test(options.profile)))
  ) {
    throw new AppError('validation', 'invalid_login_profile', 'login');
  }
}

function canStartLogin(options: LoginOptions, timeoutMs: number): boolean {
  try {
    validateLoginOptions(options);
    return Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= LOGIN_TIMEOUT_MS;
  } catch {
    return false;
  }
}

async function executeLogin(
  options: LoginOptions,
  dependencies: LoginDependencies,
): Promise<LoginResult> {
  const executable = (dependencies.resolve ?? resolveExecutable)(
    dependencies.environment ?? process.env,
  );
  const args: string[] = [...executable.args, ...LOGIN_ARGUMENTS];
  if (options.profile) args.push('--profile', options.profile);
  // 授权流程保持输入直到扫码回调；只计输出大小，不保存或返回授权内容。
  const result = await runProcess({
    file: executable.file,
    args,
    spawn: dependencies.spawn,
    signal: dependencies.signal,
    clock: dependencies.clock,
    stop: dependencies.stop,
    timeoutMs: dependencies.timeoutMs ?? LOGIN_TIMEOUT_MS,
    maxOutputBytes: CONNECTION_OUTPUT_BYTES,
    isStdinKeptOpen: true,
    canCaptureOutput: false,
  });
  if (result.failure === 'timeout') return { kind: 'timeout', reason: 'timeout' };
  if (result.failure || result.exitCode !== 0) return { kind: 'failure', reason: 'login-failed' };
  return { kind: 'success', reason: 'none' };
}

/**
 * 1. 校验唯一业务参数；2. 占用登录互斥标记；3. 运行固定命令并释放标记。
 * @param options 可选组织标识，不接受其他业务参数。
 * @param dependencies 可替换进程、程序定位、环境和取消信号。
 * @returns 成功、失败、超时或已有登录正在进行；不返回授权链接与原始输出。
 * @throws 无；参数和环境错误均转换为失败类别。
 */
export async function startLogin(
  options: LoginOptions = {},
  dependencies: LoginDependencies = {},
): Promise<LoginResult> {
  // 1. 即使绕过 TypeScript 的调用也必须检查输入，登录不经过普通 runner。
  if (!canStartLogin(options, dependencies.timeoutMs ?? LOGIN_TIMEOUT_MS)) {
    return { kind: 'failure', reason: 'configuration' };
  }
  // 2. 在任何异步操作之前设置标记，避免并发点击启动多个授权进程。
  if (isLoginActive) return { kind: 'already-running', reason: 'login-in-progress' };
  isLoginActive = true;
  try {
    // 3. 执行层负责五分钟超时和中止；所有结束路径均释放标记。
    return await executeLogin(options, dependencies);
  } catch {
    return { kind: 'failure', reason: 'configuration' };
  } finally {
    isLoginActive = false;
  }
}
