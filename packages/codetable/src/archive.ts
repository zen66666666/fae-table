// 使用系统 tar 将工作簿内所需 XML 输出到内存，供码表解析器使用。
import { closeSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { AppError, runProcess } from '../../core/src/index.ts';
import type { SpawnProcess } from '../../core/src/index.ts';

const TAR_RELATIVE_PATH = 'System32/tar.exe';
const ZIP_SIGNATURE = 0x04034b50;
const TAR_TIMEOUT_MS = 8_000;
const ARCHIVE_TIMEOUT_MS = 30_000;
const TAR_EXTRACT_ARGS = ['-xOf'] as const;
const ARCHIVE_PATH = /^xl(?:\/[a-z\d_][a-z\d_.-]*)+$/iu;

/** 读档案所需的文件、进程及停止信号依赖；默认使用本机系统实现。 */
export type CodeTableArchiveOptions = {
  filePath: string;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  spawn?: SpawnProcess;
  run?: typeof runProcess;
  hasZipHeader?: (filePath: string) => boolean;
};

/** 读取单个有效归档部件的文件名、输出大小上限和可选性。 */
export type ArchivePart = { member: string; maxOutputBytes: number; isOptional?: boolean };

/** 内存中读取单一 ZIP 部件的能力。 */
export type ReadArchivePart = (part: ArchivePart) => Promise<string | null>;

function hasZipHeader(filePath: string): boolean {
  const descriptor = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    return (
      readSync(descriptor, header, 0, header.length, 0) === header.length &&
      header.readUInt32LE() === ZIP_SIGNATURE
    );
  } finally {
    closeSync(descriptor);
  }
}

function validateArchivePath(filePath: string, check: typeof hasZipHeader): void {
  try {
    if (path.isAbsolute(filePath) && !filePath.includes('\0') && check(filePath)) return;
  } catch {
    // 捕获文件系统错误以避免异常正文包含上传路径。
  }
  throw new AppError('parse', 'invalid_codetable_archive', 'codetable');
}

/**
 * 校验内部 ZIP 部件路径，排除通配符、路径穿越和 tar 选项。
 * @param member 归档内部 POSIX 路径。
 * @returns 允许传给 tar 的路径为 true。
 * @throws 无预期错误。
 */
export function isArchivePartPath(member: string): boolean {
  return ARCHIVE_PATH.test(member);
}

/**
 * 定位系统 tar，并创建只输出指定 XML 的有界读取器。
 * @param options 已暂存的绝对路径与可替换依赖。
 * @returns 部件读取函数，不在磁盘创建解压文件。
 * @throws AppError ZIP 无效、系统 tar 不可用或读取失败。
 */
export function createArchiveReader(options: CodeTableArchiveOptions): ReadArchivePart {
  // 1. 核验 ZIP 和系统程序位置。2. 使用同一总截止时间执行各部件的受限读取。
  validateArchivePath(options.filePath, options.hasZipHeader ?? hasZipHeader); // 1.
  const environment = options.environment ?? process.env;
  const root = environment.SystemRoot ?? environment.SYSTEMROOT;
  if (!root || !path.isAbsolute(root)) {
    throw new AppError('configuration', 'codetable_tar_unavailable', 'codetable');
  }
  const file = path.join(root, TAR_RELATIVE_PATH);
  const timeout = AbortSignal.timeout(ARCHIVE_TIMEOUT_MS); // 2.
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return async ({ member, maxOutputBytes, isOptional }) => {
    if (!isArchivePartPath(member)) {
      throw new AppError('parse', 'invalid_codetable_member', 'codetable');
    }
    // -O 只允许标准输出；不会让归档中的路径或链接创建本机文件。
    const result = await (options.run ?? runProcess)({
      file,
      args: [...TAR_EXTRACT_ARGS, options.filePath, '--', member],
      maxOutputBytes,
      timeoutMs: TAR_TIMEOUT_MS,
      signal,
      spawn: options.spawn,
    });
    if (result.failure === 'timeout' || timeout.aborted) {
      throw new AppError('timeout', 'codetable_archive_timeout', 'codetable');
    }
    if (result.failure === 'spawn') {
      throw new AppError('configuration', 'codetable_tar_unavailable', 'codetable');
    }
    if (isOptional && result.failure === null && result.exitCode === 1 && !result.stdout)
      return null;
    if (result.failure || result.exitCode !== 0 || !result.stdout) {
      throw new AppError('parse', 'invalid_codetable_member', 'codetable');
    }
    return result.stdout;
  };
}
