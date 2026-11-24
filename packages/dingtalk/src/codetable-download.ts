// 搜索并下载唯一的源码编号表，供后台的临时文件导入流程使用。
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { AppError, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import {
  CODETABLE_DOWNLOAD_COMMAND,
  CODETABLE_DOWNLOAD_PATH,
  CODETABLE_FILE_NAME,
  CODETABLE_SEARCH_COMMAND,
  CODETABLE_SEARCH_PATH,
  CODETABLE_SEARCH_QUERY,
  isCodeTableNodeId,
  validateCodeTableCommand,
} from './command-policy.ts';
import { isCompleteDingtalkResult, mustSucceed } from './common.ts';
import { classifyDingtalkReason } from './connection-reason.ts';
import { createScopedRunner } from './runner.ts';
import type { RunnerOptions } from './runner.ts';
import type { Runner, RunnerResult } from './runner-types.ts';

const SEARCH_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const PERMISSION_SUBTYPES = new Set(['403', 'access_denied', 'forbidden', 'insufficient_scope']);

/** 编号表下载的工作目录、已选账号和可替换进程与文件系统依赖。 */
export type CodeTableDownloadOptions = Pick<
  RunnerOptions,
  'environment' | 'executable' | 'signal' | 'spawn'
> & {
  directory: string;
  profile: string;
  lstat?: typeof lstatSync;
};

function getSafeOutputPath(options: CodeTableDownloadOptions): string {
  const { directory, lstat = lstatSync } = options;
  try {
    if (!path.isAbsolute(directory) || !lstat(directory).isDirectory()) throw new Error();
    const output = path.join(directory, CODETABLE_FILE_NAME);
    // 调用方为每次导入创建独立目录；任何已有目标都可能导致覆盖或跟随链接。
    if (lstat(output, { throwIfNoEntry: false })) throw new Error();
    return output;
  } catch {
    throw new AppError('configuration', 'codetable_invalid_directory', CODETABLE_DOWNLOAD_PATH);
  }
}

function assertWrittenFile(output: string, lstat: typeof lstatSync): void {
  try {
    // 不能仅凭退出码、响应中的路径或声称的文件大小认定下载已成功。
    const file = lstat(output);
    if (file.isFile() && file.size > 0) return;
  } catch {
    // 结果和本地异常均不向调用方返回路径或原始文本。
  }
  throw new AppError('process', 'codetable_download_failed', CODETABLE_DOWNLOAD_PATH);
}

function readDriveReply(result: RunnerResult, operation: string): JsonObject {
  const reason = classifyDingtalkReason(result.error);
  const subtype = result.error?.subtype.toLowerCase() ?? '';
  if (reason === 'permission' || PERMISSION_SUBTYPES.has(subtype))
    throw new AppError('permission', 'codetable_permission', operation);
  if (reason === 'login-required')
    throw new AppError('authentication', 'codetable_login_required', operation);
  if (reason === 'timeout') throw new AppError('process', 'codetable_timeout', operation);
  if (reason === 'protocol' || result.kind === 'unparseable')
    throw new AppError('structure', 'codetable_invalid_result', operation);
  if (result.kind !== 'success')
    throw new AppError('process', 'codetable_download_failed', operation);
  return mustSucceed(result, operation);
}

function getTargetNode(reply: JsonObject): string {
  const records = reply.files;
  if (!isCompleteDingtalkResult(reply) || !Array.isArray(records)) {
    // 不完整或不可解析的结果无法证明唯一，不得发起下载。
    throw new AppError('structure', 'codetable_invalid_result', CODETABLE_SEARCH_PATH);
  }
  // 搜索必须只返回一项，禁止从多条结果里筛选或猜测需要下载的文件。
  if (records.length === 0)
    throw new AppError('business', 'codetable_not_found', CODETABLE_SEARCH_PATH);
  if (records.length !== 1)
    throw new AppError('business', 'codetable_ambiguous', CODETABLE_SEARCH_PATH);
  const entry: unknown = records[0];
  if (!isObject(entry) || typeof entry.name !== 'string' || !isCodeTableNodeId(entry.dentryId))
    throw new AppError('structure', 'codetable_invalid_result', CODETABLE_SEARCH_PATH);
  if (!entry.name.startsWith(CODETABLE_SEARCH_QUERY))
    throw new AppError('business', 'codetable_not_found', CODETABLE_SEARCH_PATH);
  return entry.dentryId;
}

function createCodeTableRunner(options: CodeTableDownloadOptions, dentryId?: string): Runner {
  const { directory, environment, executable, profile, signal, spawn } = options;
  return createScopedRunner(
    {
      canWriteLogs: false,
      environment,
      executable,
      signal,
      spawn,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      timeoutMs: dentryId === undefined ? SEARCH_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS,
    },
    { cwd: directory, validate: (argv) => validateCodeTableCommand(argv, { profile, dentryId }) },
  );
}

/**
 * 从同一个已选账号搜索并下载唯一匹配的编号表。
 * @param options 后台新建的临时目录、已选账号及可替换运行依赖。
 * @returns 固定编号表文件生成后完成；原始命令输出只在内存用于判断结果。
 * @throws AppError：目录不安全、搜索未唯一匹配、鉴权失败、超时或下载失败。
 */
export async function downloadCodeTable(options: CodeTableDownloadOptions): Promise<void> {
  // 1. 校验目录和账号。2. 只搜索固定查询。3. 只下载本轮唯一匹配结果并核对本地文件。
  const output = getSafeOutputPath(options); // 1.
  if (
    typeof options.profile !== 'string' ||
    !options.profile.trim() ||
    options.profile.startsWith('-') ||
    options.profile.includes(',') ||
    /[\x00-\x1f\x7f]/u.test(options.profile)
  )
    throw new AppError('authentication', 'codetable_login_required', CODETABLE_SEARCH_PATH);
  const commonArgs = ['--profile', options.profile, '--format', 'json'];
  const search = createCodeTableRunner(options); // 2.
  const found = await search([
    ...CODETABLE_SEARCH_COMMAND,
    '--query',
    CODETABLE_SEARCH_QUERY,
    ...commonArgs,
  ]);
  const dentryId = getTargetNode(readDriveReply(found, CODETABLE_SEARCH_PATH));
  const download = createCodeTableRunner(options, dentryId); // 3. 节点不能从用户输入或上一轮搜索取得。
  const downloaded = await download([
    ...CODETABLE_DOWNLOAD_COMMAND,
    '--node',
    dentryId,
    '--output',
    CODETABLE_FILE_NAME,
    ...commonArgs,
  ]);
  readDriveReply(downloaded, CODETABLE_DOWNLOAD_PATH);
  assertWrittenFile(output, options.lstat ?? lstatSync);
}
