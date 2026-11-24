// 为本机设置存储提供可替换的文本文件操作，避免各模块重复实现原子写入。
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isObject } from './object.ts';

const FILE_SYSTEM = { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync };

/** 配置存储依赖的本机文件操作。 */
export type TextFileSystem = typeof FILE_SYSTEM;

type FileOptions = { filename: string; fileSystem?: TextFileSystem };

/**
 * 读取可能尚未创建的本机 UTF-8 文本文件。
 * @param options 文件路径和可替换的文件操作。
 * @returns 文件内容，文件不存在时返回 null。
 * @throws 文件读取失败，文件不存在除外。
 */
export function readOptionalTextFile(options: FileOptions): string | null {
  try {
    return (options.fileSystem ?? FILE_SYSTEM).readFileSync(options.filename, 'utf8');
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 删除可能已经清除的本机文件。
 * @param options 文件路径和可替换的文件操作。
 * @returns 删除完成后无返回值。
 * @throws 文件删除失败，文件不存在除外。
 */
export function removeOptionalFile(options: FileOptions): void {
  try {
    (options.fileSystem ?? FILE_SYSTEM).unlinkSync(options.filename);
  } catch (error) {
    if (!isObject(error) || error.code !== 'ENOENT') throw error;
  }
}

/**
 * 在原目录中原子替换一个本机 UTF-8 文本文件。
 * @param options 文件路径、完整内容、可替换的文件操作和随机标识。
 * @returns 文件替换完成后无返回值。
 * @throws 创建目录、写入临时文件或替换目标文件失败。
 */
export function writeAtomicTextFile(
  options: FileOptions & { text: string; createId?: () => string },
): void {
  // 1. 创建父目录。2. 将完整内容写入独占临时文件。3. 原子替换并清理失败残留。
  const fileSystem = options.fileSystem ?? FILE_SYSTEM;
  const temporary = `${options.filename}.${(options.createId ?? randomUUID)()}.tmp`;
  fileSystem.mkdirSync(path.dirname(options.filename), { recursive: true }); // 1.
  let hasWrittenTemporary = false;
  try {
    // 2. 独占创建避免覆盖其他调用的临时文件，权限限制本机内容的访问。
    fileSystem.writeFileSync(temporary, options.text, { flag: 'wx', mode: 0o600 });
    hasWrittenTemporary = true;
    fileSystem.renameSync(temporary, options.filename); // 3.
  } catch (error) {
    if (hasWrittenTemporary || !isObject(error) || error.code !== 'EEXIST') {
      try {
        removeOptionalFile({ filename: temporary, fileSystem });
      } catch {
        // 保留最初的写入或改名错误，供调用者安全分类。
      }
    }
    throw error;
  }
}
