// 组合命令白名单、安装定位和有界进程执行，提供钉钉只读调用入口。
import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { validateCommand } from './command-policy.ts';
import { resolveExecutable } from './executable.ts';
import { executeReadCommand } from './runner-process.ts';
import { runtimeDirectory } from './runtime-directory.ts';
import type { Executable, Runner, RunnerResult, SpawnFunction } from './runner-types.ts';

export { validateCommand } from './command-policy.ts';
export { resolveExecutable } from './executable.ts';
export { classifyResult } from './result-classifier.ts';
export { REPO_ROOT, runtimeDirectory } from './runtime-directory.ts';
export type { Executable, Runner, RunnerResult, SafeError, SpawnFunction } from './runner-types.ts';

/** 执行器配置；可注入进程工厂、程序路径、日志位置和资源限额。 */
export type RunnerOptions = {
  spawn?: SpawnFunction;
  logDir?: string;
  executable?: Executable;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** 工作台读取必须关闭落盘；探针默认仍保留原始日志。 */
  canWriteLogs?: boolean;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};
type ResolvedOptions = RunnerOptions & {
  spawn: SpawnFunction;
  timeoutMs: number;
  maxOutputBytes: number;
  policy: RunnerPolicy;
};
type RunnerPolicy = { validate: typeof validateCommand; cwd?: string };

function buildFailure(type: string, subtype: string, operation: string): RunnerResult {
  return { kind: 'failure', exitCode: null, error: { type, subtype, operation } };
}

function prepareExecutable(options: RunnerOptions): { executable: Executable; directory?: string } {
  const executable = options.executable || resolveExecutable(options.environment);
  // 注入路径也必须禁止 shell 包装脚本，避免绕过正常安装路径检查。
  if (!path.isAbsolute(executable.file) || /\.(cmd|bat|ps1|psm1)$/i.test(executable.file)) {
    throw new Error('DWS command rejected: invalid_executable');
  }
  // 单据只驻留内存；关闭日志时连运行目录都不创建，避免业务读取产生磁盘副作用。
  return {
    executable,
    directory: options.canWriteLogs === false ? undefined : runtimeDirectory(options.logDir),
  };
}

async function runCommand(
  argv: readonly string[],
  options: ResolvedOptions,
): Promise<RunnerResult> {
  let command: { path: string; durationMs?: number };
  try {
    command = options.policy.validate(argv);
  } catch (error) {
    return buildFailure(
      'policy',
      (error as { subtype?: string }).subtype || 'command_not_allowed',
      'rejected',
    );
  }
  // 流式订阅必须使用有界、可正常停止的事件执行器，不能复用普通进程超时终止。
  if (command.path === 'event consume')
    return buildFailure('policy', 'event_runner_required', command.path);
  let prepared: { executable: Executable; directory?: string };
  try {
    prepared = prepareExecutable(options);
  } catch {
    return buildFailure('configuration', 'runner_configuration', command.path);
  }
  return await executeReadCommand({
    ...prepared,
    argv,
    cwd: options.policy.cwd,
    operation: command.path,
    spawn: options.spawn,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    signal: options.signal,
  });
}

/**
 * 创建只允许白名单读取操作的执行器。
 * @param options 可执行程序、进程工厂、日志位置及超时和输出限额。
 * @returns 接收参数数组并异步返回结构化结果的函数。
 * @throws 超时或输出限额不是正安全整数时抛错；调用失败通过结果返回。
 */
export function createRunner(options: RunnerOptions = {}): Runner {
  return createScopedRunner(options, { validate: validateCommand });
}

/**
 * 为模块内部有专用白名单的流程复用同一执行器和限额校验。
 * @param options 可替换进程和资源限额；专用读取应关闭日志。
 * @param policy 专用命令验证器及已校验的工作目录。
 * @returns 按参数数组执行命令的受限函数；普通业务入口使用原白名单。
 * @throws 无效的超时或输出限额；执行失败由返回值报告。
 */
export function createScopedRunner(options: RunnerOptions, policy: RunnerPolicy): Runner {
  const spawn = options.spawn || nodeSpawn;
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0
  ) {
    throw new Error('Invalid DWS process limits');
  }
  return (argv) => runCommand(argv, { ...options, spawn, timeoutMs, maxOutputBytes, policy });
}
