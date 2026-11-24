// 创建和安全移除编码表临时目录，供单次更新和后台启动恢复使用。
import { lstat, mkdtemp, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { AppError, asObject } from '../../../packages/core/src/index.ts';
import { CODETABLE_FILE_NAME } from '../../../packages/dingtalk/src/index.ts';

const TEMP_DIRECTORY_PREFIX = 'codetable-';
const TEMP_DIRECTORY_SUFFIX = /^[a-z0-9]{6}$/iu;
const CLEANUP_MAX_RETRIES = 5;
const CLEANUP_RETRY_DELAY_MS = 150;
const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const FILES = { lstat, mkdtemp, readdir, realpath, rmdir, unlink };

/** 工作目录与可替换的文件操作，供启动清理、更新和隔离自检复用。 */
export type CodeTableDirectoryOptions = {
  dataDir: string;
  files?: typeof FILES;
  wait?: (milliseconds: number) => Promise<void>;
};

type Directory = { parent: string; directory: string };

function isWorkDirectoryName(name: string): boolean {
  return (
    name.startsWith(TEMP_DIRECTORY_PREFIX) &&
    TEMP_DIRECTORY_SUFFIX.test(name.slice(TEMP_DIRECTORY_PREFIX.length))
  );
}

/**
 * 在真实运行目录下创建一次更新专用的目录。
 * @param options 当前实例的数据目录及文件操作。
 * @returns 真实父目录及已核对的直属工作目录。
 * @throws AppError 创建位置异常，或文件系统拒绝指定操作。
 */
export async function createCodeTableDirectory(
  options: CodeTableDirectoryOptions,
): Promise<Directory> {
  const files = options.files ?? FILES;
  const parent = await files.realpath(options.dataDir);
  const directory = await files.mkdtemp(path.join(parent, TEMP_DIRECTORY_PREFIX));
  if (path.dirname(directory) !== parent || !isWorkDirectoryName(path.basename(directory))) {
    throw new AppError('policy', 'codetable_invalid_directory', 'codetable');
  }
  return { parent, directory };
}

async function removeOwnedDirectory(candidate: Directory, files: typeof FILES): Promise<boolean> {
  // 1. 只处理真实直属目录。2. 核对内容。3. 删除固定文件及空目录，不递归删除。
  const { parent, directory } = candidate;
  if (path.dirname(directory) !== parent || !isWorkDirectoryName(path.basename(directory)))
    return false;
  const stat = await files.lstat(directory); // 1.
  if (!stat.isDirectory() || (await files.realpath(directory)) !== directory) return false;
  const entries = await files.readdir(directory, { withFileTypes: true }); // 2.
  if (entries.some((entry) => entry.name !== CODETABLE_FILE_NAME || !entry.isFile())) return false;
  if (entries.length) {
    // 文件可能刚被清理掉；此时继续删除已核验的空目录。
    await files.unlink(path.join(directory, CODETABLE_FILE_NAME)).catch((error: unknown) => {
      if (asObject(error).code !== 'ENOENT') throw error;
    }); // 3.
  }
  await files.rmdir(directory);
  return true;
}

/**
 * 在下载和解析离开目录后清除本模块的工作簿；Windows 短时占用时有限重试。
 * @param options 已核对的运行父目录、专用子目录和可替换文件依赖。
 * @returns 目录已移除或不存在时为 true；保留未知文件或未能移除时为 false。
 * @throws 无预期错误；文件系统错误转换为结果。
 */
export async function removeCodeTableDirectory(
  options: Directory & Omit<CodeTableDirectoryOptions, 'dataDir'>,
): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await removeOwnedDirectory(options, options.files ?? FILES);
    } catch (error) {
      const { code } = asObject(error);
      if (code === 'ENOENT') return true;
      if (typeof code !== 'string' || !RETRY_CODES.has(code) || attempt === CLEANUP_MAX_RETRIES)
        return false;
      await (options.wait ?? wait)(CLEANUP_RETRY_DELAY_MS);
    }
  }
}

/**
 * 恢复上次退出遗留的编码表临时目录，跳过链接、未知目录名和其他文件。
 * @param options 后台实例独占锁保护下的运行目录及可替换文件操作。
 * @returns 清理尝试结束；无法访问目录时留给下次启动。
 * @throws 无预期错误。
 */
export async function cleanupCodeTableDirectories(
  options: CodeTableDirectoryOptions,
): Promise<void> {
  // 1. 找到真实运行目录和专用候选。2. 逐个核对并安全移除，不影响单据功能。
  const files = options.files ?? FILES;
  try {
    const parent = await files.realpath(options.dataDir); // 1.
    const entries = await files.readdir(parent, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !isWorkDirectoryName(entry.name)) continue;
      await removeCodeTableDirectory({
        ...options,
        parent,
        directory: path.join(parent, entry.name),
      }); // 2.
    }
  } catch {
    // 运行目录临时不可访问时不能猜测真实位置，也不能影响正常启动。
  }
}
