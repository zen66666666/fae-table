// 下载并解析一次编码表，供后台任务管理临时工作簿的生命周期。
import path from 'node:path';
import { AppError } from '../../../packages/core/src/index.ts';
import type { CodeTableReason, SpawnProcess } from '../../../packages/core/src/index.ts';
import { CODETABLE_FILE_NAME, downloadCodeTable } from '../../../packages/dingtalk/src/index.ts';
import { createCodeTableIndex } from '../../../packages/codetable/src/index.ts';
import type { CodeTableIndex } from '../../../packages/codetable/src/index.ts';
import { createCodeTableDirectory, removeCodeTableDirectory } from './codetable-directory.ts';
import type { CodeTableDirectoryOptions } from './codetable-directory.ts';

const DOWNLOAD_REASONS: ReadonlyMap<string, CodeTableReason> = new Map([
  ['codetable_not_found', 'not-found'],
  ['codetable_ambiguous', 'multiple-files'],
  ['codetable_permission', 'permission'],
  ['codetable_login_required', 'login-required'],
  ['codetable_timeout', 'timeout'],
]);

/** 编码表任务的授权账号、运行位置及可替换的外部操作。 */
export type CodeTableLoadOptions = CodeTableDirectoryOptions & {
  profile: string;
  environment: NodeJS.ProcessEnv;
  spawn: SpawnProcess;
  signal: AbortSignal;
  download?: typeof downloadCodeTable;
  parse?: typeof createCodeTableIndex;
};

/** 单次更新的内存索引或安全失败类别。 */
export type CodeTableLoadResult =
  | { kind: 'success'; index: CodeTableIndex }
  | { kind: 'failure'; reason: Exclude<CodeTableReason, 'none'> };

async function readDownloadedIndex(
  options: CodeTableLoadOptions & { directory: string },
): Promise<CodeTableLoadResult> {
  // 1. 下载一次已核实的工作簿。2. 只解析专用目录中这一固定文件。
  const { profile, environment, spawn, signal, directory } = options;
  const dependencies = { environment, spawn, signal };
  try {
    signal.throwIfAborted();
    await (options.download ?? downloadCodeTable)({ ...dependencies, profile, directory }); // 1.
  } catch (error) {
    const reason = error instanceof AppError ? DOWNLOAD_REASONS.get(error.subtype) : undefined;
    return { kind: 'failure', reason: reason && reason !== 'none' ? reason : 'download-failed' };
  }
  try {
    signal.throwIfAborted();
    const index = await (options.parse ?? createCodeTableIndex)({
      ...dependencies,
      filePath: path.join(directory, CODETABLE_FILE_NAME),
    }); // 2.
    return { kind: 'success', index };
  } catch {
    return { kind: 'failure', reason: 'parse-failed' };
  }
}

/**
 * 读取编码表并清理下载目录，即使下载或解析失败也执行清理。
 * @param options 已核实账号、资源取消信号及可替换的文件和进程依赖。
 * @returns 可发布的纯内存索引或固定失败类别。
 * @throws 预期的文件、下载及解析错误均转换为结果。
 */
export async function loadCodeTable(options: CodeTableLoadOptions): Promise<CodeTableLoadResult> {
  // 1. 分配专用目录。2. 读取索引。3. 清除全部临时文件后再发布。
  let workDirectory: Awaited<ReturnType<typeof createCodeTableDirectory>>;
  try {
    workDirectory = await createCodeTableDirectory(options); // 1.
  } catch {
    return { kind: 'failure', reason: 'download-failed' };
  }
  let isClean = false;
  let result: CodeTableLoadResult;
  try {
    result = await readDownloadedIndex({ ...options, directory: workDirectory.directory }); // 2.
  } finally {
    // 等待已取消的下载或解析退出再删，避免子进程继续写入临时目录。
    isClean = await removeCodeTableDirectory({
      ...workDirectory,
      files: options.files,
      wait: options.wait,
    }); // 3.
  }
  return isClean ? result : { kind: 'failure', reason: 'cleanup-failed' };
}
