// 解析 Windows 文档中的手册目录，并用资源管理器打开后台配置的目录。
import { spawn as nodeSpawn } from 'node:child_process';
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { AppError, runPowerShell } from '../../../packages/core/src/index.ts';
import type { PowerShellOptions, SpawnProcess } from '../../../packages/core/src/index.ts';

const MANUALS_DIRECTORY_NAME = 'FAE 工作台手册';
const EXPLORER_FILENAME = 'explorer.exe';
const FOLDER_TIMEOUT_MS = 5_000;
const FOLDER_OUTPUT_BYTES = 16_384;
const DOCUMENTS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  '$folder = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments, [Environment+SpecialFolderOption]::DoNotVerify)',
  '[Console]::Out.Write($folder)',
].join('\n');

/** 获取文档目录所需的可替换系统环境、进程和停止信号。 */
export type GetManualsDirectoryOptions = Pick<
  PowerShellOptions,
  'environment' | 'spawn' | 'signal' | 'run'
>;

/** 打开已经准备好的手册目录所需的系统环境和可替换文件、进程操作。 */
export type OpenManualsDirectoryOptions = {
  directory: string;
  environment?: NodeJS.ProcessEnv;
  spawn?: SpawnProcess;
  signal?: AbortSignal;
  lstat?: typeof lstatSync;
};

function isSafeAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) && !/["\x00-\x1f\x7f]/u.test(value);
}

/**
 * 用 Windows 已知文件夹 API 获取真实文档位置，保留重定向和中文路径。
 * @param options 可替换的系统环境、PowerShell 执行器、进程与停止信号。
 * @returns 本机手册目录的绝对路径，目录可以尚未创建。
 * @throws AppError 文档已知文件夹无法解析时抛出安全错误。
 */
export async function getManualsDirectory(
  options: GetManualsDirectoryOptions = {},
): Promise<string> {
  // 1. 读取系统实际文档位置。2. 仅拼接固定的手册子目录名。
  try {
    const result = await runPowerShell({
      // 1.
      ...options,
      script: DOCUMENTS_SCRIPT,
      timeoutMs: FOLDER_TIMEOUT_MS,
      maxOutputBytes: FOLDER_OUTPUT_BYTES,
    });
    const folder = result.stdout.replace(/^\uFEFF/u, '');
    if (!result.failure && result.exitCode === 0 && isSafeAbsolutePath(folder))
      return path.join(folder, MANUALS_DIRECTORY_NAME); // 2.
  } catch {
    // PowerShell 诊断可能含本机路径，只公开安全错误类别。
  }
  throw new AppError('configuration', 'manuals_directory_unavailable', 'manuals');
}

/**
 * 用独立参数向 Windows 资源管理器分派当前后台的手册目录。
 * @param options 已配置的目录和可替换环境、检查函数、进程启动器及停止信号。
 * @returns 系统进程确认创建后完成，资源管理器拥有自己的生命周期。
 * @throws AppError 目录不安全、实例正在结束或者资源管理器启动失败。
 */
export async function openManualsDirectory(options: OpenManualsDirectoryOptions): Promise<void> {
  // 1. 校验固定目录和系统路径。2. 启动独立资源管理器并只等开始分派。
  const environment = options.environment ?? process.env;
  const systemRoot = environment.SystemRoot ?? environment.SYSTEMROOT;
  let directory: string;
  try {
    if (
      !systemRoot ||
      !isSafeAbsolutePath(systemRoot) ||
      !isSafeAbsolutePath(options.directory) ||
      options.signal?.aborted
    )
      throw new Error();
    directory = path.resolve(options.directory);
    if (!(options.lstat ?? lstatSync)(directory).isDirectory()) throw new Error(); // 1.
  } catch {
    throw new AppError('configuration', 'manuals_directory_unavailable', 'manuals');
  }
  try {
    // 2. 不交由 shell 解释，也不让后台关闭时终止用户的资源管理器。
    await new Promise<void>((resolve, reject) => {
      const child = (options.spawn ?? nodeSpawn)(
        path.join(systemRoot, EXPLORER_FILENAME),
        [directory],
        {
          shell: false,
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        },
      );
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  } catch {
    throw new AppError('process', 'manuals_folder_open_failed', 'manuals');
  }
}
