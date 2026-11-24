// 通过 Windows 系统进程服务启动独立后台，供工作台启动器脱离调用方任务生命周期。
import path from 'node:path';
import { AppError } from './app-error.ts';
import { isObject } from './object.ts';
import { runPowerShell } from './powershell.ts';
import type { runProcess } from './run-process.ts';

const CREATION_TIMEOUT_MS = 15_000;
const CREATION_OUTPUT_BYTES = 16_384;

/** 独立进程的参数；环境必须由调用方筛选，不能传入凭据或任意命令文本。 */
export type IndependentProcessOptions = {
  file: string;
  args: readonly string[];
  directory: string;
  environment: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  run?: typeof runProcess;
};

function quoteWindowsArgument(value: string): string {
  // Win32_Process.Create 接收 Windows 命令行，必须使用原生参数规则而非 shell 转义。
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function createLaunchScript(options: IndependentProcessOptions): string {
  const payload = Buffer.from(
    JSON.stringify({
      commandLine: [options.file, ...options.args].map(quoteWindowsArgument).join(' '),
      directory: options.directory,
      environment: options.environment,
    }),
    'utf8',
  ).toString('base64');
  // 业务值仅作为 Base64 JSON 数据进入固定脚本，不会成为 PowerShell 表达式。
  return [
    "$ErrorActionPreference = 'Stop'",
    `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)`,
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    `$variables = @($payload.environment.PSObject.Properties | ForEach-Object { $_.Name + '=' + [string]$_.Value })`,
    `$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = [string[]]$variables }`,
    `$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = [string]$payload.commandLine; CurrentDirectory = [string]$payload.directory; ProcessStartupInformation = $startup }`,
    `@{ returnValue = [int]$created.ReturnValue; processId = [int]$created.ProcessId } | ConvertTo-Json -Compress`,
  ].join('\n');
}

/**
 * 1. 校验本机启动参数；2. 由系统服务创建后台；3. 返回创建结果。
 * @param options 原生程序、参数数组、工作目录、筛选后的环境和可替换执行依赖。
 * @returns 独立进程的 PID；不返回环境、命令行或原始系统输出。
 * @throws AppError：平台不支持、输入无效或系统进程服务拒绝创建。
 */
export async function startIndependentProcess(options: IndependentProcessOptions): Promise<number> {
  // 1. 只接受绝对路径和不含空字符的参数，防止路径歧义或原生命令行截断。
  if ((options.platform ?? process.platform) !== 'win32')
    throw new AppError('configuration', 'unsupported_platform', 'launch');
  if (
    !path.isAbsolute(options.file) ||
    !path.isAbsolute(options.directory) ||
    [options.file, options.directory, ...options.args].some((value) => value.includes('\0'))
  ) {
    throw new AppError('validation', 'invalid_launch_path', 'launch');
  }
  // 2. WMI 创建的后台属于系统进程服务，不会随启动器及其子进程清理而退出。
  const result = await runPowerShell({
    script: createLaunchScript(options),
    environment: options.environment,
    run: options.run,
    timeoutMs: CREATION_TIMEOUT_MS,
    maxOutputBytes: CREATION_OUTPUT_BYTES,
  });
  if (result.failure || result.exitCode !== 0)
    throw new AppError('process', 'background_creation_failed', 'launch');
  // 3. 只采纳系统方法的成功代码和正整数 PID，不将诊断文本带到启动器输出。
  try {
    const created: unknown = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
    if (isObject(created) && created.returnValue === 0 && Number.isSafeInteger(created.processId)) {
      if (Number(created.processId) > 0) return Number(created.processId);
    }
  } catch {
    // 无效响应与创建失败使用同一安全错误类别。
  }
  throw new AppError('process', 'background_creation_failed', 'launch');
}
