// 为后台分派和独立进程创建统一定位系统 PowerShell，生命周期始终委托有界执行器。
import path from 'node:path';
import { AppError } from './app-error.ts';
import { runProcess } from './run-process.ts';
import type { ProcessResult, SpawnProcess } from './process-types.ts';

const POWERSHELL_RELATIVE_PATH = 'System32/WindowsPowerShell/v1.0/powershell.exe';

/** 固定 PowerShell 脚本与有界执行配置；调用方须将业务输入编码为数据而非脚本文本。 */
export type PowerShellOptions = {
  script: string;
  /** Windows 图形对话框等需要单线程单元时显式启用。 */
  isSta?: boolean;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxOutputBytes?: number;
  canCaptureOutput?: boolean;
  stdin?: string;
  signal?: AbortSignal;
  spawn?: SpawnProcess;
  run?: typeof runProcess;
};

/**
 * 1. 定位系统 PowerShell；2. 编码固定脚本；3. 委托共用执行器进行有界调用。
 * @param options 固定脚本、系统环境、资源上限和可替换进程执行依赖。
 * @returns 有界进程结果；不解释脚本输出，也不直接打印诊断信息。
 * @throws AppError：系统目录缺失或不是绝对路径；非法资源上限由执行器拒绝。
 */
export async function runPowerShell(options: PowerShellOptions): Promise<ProcessResult> {
  // 1. 不通过 PATH 查找同名脚本，确保使用 Windows 系统自带的 PowerShell。
  const environment = options.environment ?? process.env;
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  if (!systemRoot || !path.isAbsolute(systemRoot))
    throw new AppError('configuration', 'missing_system_root', 'launch');
  // 2. 整段脚本作为独立编码参数传入，不让外层 shell 重新解释内容。
  const encodedScript = Buffer.from(options.script, 'utf16le').toString('base64');
  // 3. 超时、输出上限及进程关闭复用唯一实现，不创建第二套生命周期管理。
  return await (options.run ?? runProcess)({
    file: path.join(systemRoot, POWERSHELL_RELATIVE_PATH),
    args: [
      '-NoProfile',
      '-NonInteractive',
      ...(options.isSta ? ['-STA'] : []),
      '-EncodedCommand',
      encodedScript,
    ],
    timeoutMs: options.timeoutMs,
    maxOutputBytes: options.maxOutputBytes,
    canCaptureOutput: options.canCaptureOutput,
    stdin: options.stdin,
    signal: options.signal,
    spawn: options.spawn,
  });
}
