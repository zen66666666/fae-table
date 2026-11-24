// 将已校验的只读命令交给 core 执行，仅在钉钉模块保存日志并判定 CLI 返回。
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runProcess } from '../../core/src/index.ts';
import type { ProcessResult } from '../../core/src/index.ts';
import { classifyResult } from './result-classifier.ts';
import { REPO_ROOT } from './runtime-directory.ts';
import type { Executable, RunnerResult, SpawnFunction } from './runner-types.ts';

const TERMINATION_TIMEOUT_MS = 1000;
const LOG_MODE = 0o600;
const FAILURE_SUBTYPES: Record<NonNullable<ProcessResult['failure']>, string> = {
  timeout: 'timeout',
  spawn: 'spawn_failed',
  'output-limit': 'output_limit',
  aborted: 'aborted',
};

/** 单次只读进程参数；命令与目录须预先校验，日志写入和运行标识可替换。 */
export type ProcessOptions = {
  argv: readonly string[];
  operation: string;
  cwd?: string;
  directory?: string;
  executable: Executable;
  spawn: SpawnFunction;
  timeoutMs: number;
  maxOutputBytes: number;
  writeLog?: typeof writeFileSync;
  createId?: () => string;
  signal?: AbortSignal;
};

function writeProcessLogs(context: {
  options: ProcessOptions;
  logName: string;
  result: ProcessResult;
}): boolean {
  const { options, logName, result } = context;
  try {
    const writeLog = options.writeLog ?? writeFileSync;
    writeLog(`${logName}.stdout`, result.stdout, { mode: LOG_MODE });
    writeLog(`${logName}.stderr`, result.stderr, { mode: LOG_MODE });
    return true;
  } catch {
    return false;
  }
}

function classifyProcessResult(context: {
  operation: string;
  result: ProcessResult;
  hasWrittenLogs: boolean;
}): RunnerResult {
  const { operation, result, hasWrittenLogs } = context;
  // 日志失败优先于执行失败，保留原读取执行器不能丢失原始输出的错误约定。
  const subtype = !hasWrittenLogs
    ? 'log_write_failed'
    : result.failure
      ? FAILURE_SUBTYPES[result.failure]
      : undefined;
  return subtype
    ? {
        kind: 'failure',
        exitCode: result.exitCode,
        error: { type: 'process', subtype, operation },
      }
    : classifyResult(result.stdout, result.stderr, result.exitCode, operation);
}

/**
 * 1. 委托 core 有界执行；2. 将原始输出写入已校验目录；3. 判定原有 CLI 契约。
 * @param options 命令、可执行文件、日志目录及资源限额。
 * @returns 与既有读取执行器相同的结构化结果和错误子类型。
 * @throws 未预期的进程对象或注入的运行标识函数错误可能导致拒绝。
 */
export async function executeReadCommand(options: ProcessOptions): Promise<RunnerResult> {
  const logName =
    options.directory === undefined
      ? undefined
      : path.join(options.directory, (options.createId ?? randomUUID)());
  // 1. 只读命令保留立即终止、最多等待一秒和进程错误立即返回的已验证行为。
  const result = await runProcess({
    file: options.executable.file,
    args: [...options.executable.args, ...options.argv],
    spawn: options.spawn,
    cwd: options.cwd ?? REPO_ROOT,
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    stopOptions: { isImmediate: true, timeoutMs: TERMINATION_TIMEOUT_MS },
    processErrorPolicy: 'finish',
    signal: options.signal,
  });
  // 2. 即使启动失败也保存空日志，与原执行器保持一致。
  // 无日志目录代表显式内存模式，不生成运行标识、不调用任何文件写入。
  const hasWrittenLogs = logName === undefined || writeProcessLogs({ options, logName, result });
  // 3. core 不解释钉钉协议，分类器仍留在业务模块。
  return classifyProcessResult({ operation: options.operation, result, hasWrittenLogs });
}
