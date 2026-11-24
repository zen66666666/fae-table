// 管理已经确认的资料目录、下载暂存和不覆盖原件的发布，供手册存储使用。
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { getCatalogWriteFailure, isObject } from '../../core/src/index.ts';
import { assertManualStoreActive, ManualDownloadError } from './download-error.ts';
import { getCollisionFileName, isSavedFileName } from './file-name.ts';
import { downloadVerifiedPdf } from './pdf-request.ts';
import type { VerifiedPdf } from './pdf-request.ts';
import { verifyPdfStream } from './read-pdf-input.ts';
import type { ManualRequestOptions } from './request.ts';

const FILE_SYSTEM = { link, lstat, mkdir, open, realpath, unlink };
const TEMP_PREFIX = '.fae-manual-';
const TEMP_EXTENSION = '.part';
const FILE_MODE = 0o600;
const MAX_COLLISION_ATTEMPTS = 128;

/** 可替换的资料文件操作，默认使用本机文件系统。 */
export type ManualFileSystem = typeof FILE_SYSTEM;

type SavedFile = { directory: string; fileName: string; size: number };
type FileOptions = { fileSystem?: Partial<ManualFileSystem> };

function isFileError(error: unknown, code: string): boolean {
  return isObject(error) && error.code === code;
}

function getStorageError(): ManualDownloadError {
  return new ManualDownloadError('storage');
}

function getFolderWriteError(error: unknown): ManualDownloadError {
  // 只在确认写入真实资料目录的调用处使用，网络、索引和只读操作不能借系统错误码降级目录状态。
  return new ManualDownloadError('storage', { writeFailure: getCatalogWriteFailure(error) });
}

async function writeToFolder<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    throw getFolderWriteError(error);
  }
}

/**
 * 按平台路径规则比较两个已经核实的绝对路径。
 * @param left 第一个路径。
 * @param right 第二个路径。
 * @returns 指向同一路径时为 true。
 * @throws 无预期错误。
 */
export function isSameManualPath(left: string, right: string): boolean {
  return path.relative(left, right) === '';
}

function getSavedPath(options: Pick<SavedFile, 'directory' | 'fileName'>): string {
  const { directory, fileName } = options;
  if (!path.isAbsolute(directory) || !isSavedFileName(fileName)) throw getStorageError();
  // 文件名不允许路径分隔符、设备名或其他特殊字符，且最终路径只能是目录的直属文件。
  const filename = path.join(directory, fileName);
  if (!isSameManualPath(directory, path.dirname(filename))) throw getStorageError();
  return filename;
}

/**
 * 核实系统所给资料目录，仅显式允许时创建缺失目录。
 * @param options 目录解析、是否允许创建、停止信号与可替换文件操作。
 * @returns 存在的资料目录绝对路径。
 * @throws ManualDownloadError 目录无效或无法创建。
 */
export async function ensureManualDirectory(
  options: FileOptions & {
    getDirectory: () => Promise<string>;
    canCreateDirectory: boolean;
    signal?: AbortSignal;
  },
): Promise<string> {
  try {
    assertManualStoreActive(options.signal);
    const files = { ...FILE_SYSTEM, ...options.fileSystem };
    const directory = await options.getDirectory();
    if (!path.isAbsolute(directory) || directory.includes('\0')) throw getStorageError();
    assertManualStoreActive(options.signal);
    if (options.canCreateDirectory) await files.mkdir(directory, { recursive: true });
    const resolved = await files.realpath(directory);
    if (!path.isAbsolute(resolved) || !(await files.lstat(resolved)).isDirectory())
      throw getStorageError();
    assertManualStoreActive(options.signal);
    return resolved;
  } catch (error) {
    if (error instanceof ManualDownloadError) throw error;
    throw getStorageError();
  }
}

function isSameFile(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * 检查父目录、已索引大小和实际文件，再打开受控只读句柄。
 * @param options 已确认目录、文件信息及可替换文件操作。
 * @returns 验证通过的句柄，大小或文件不符时为 undefined；调用者负责关闭。
 * @throws ManualDownloadError 本地文件操作失败。
 */
export async function openSavedFile(
  options: SavedFile & FileOptions,
): Promise<FileHandle | undefined> {
  // 1. 验证为目录内的普通文件。2. 打开后比对同一对象，避免跟随替换后的链接。
  const files = { ...FILE_SYSTEM, ...options.fileSystem };
  const filename = getSavedPath(options);
  let handle: FileHandle | undefined;
  try {
    const before = await files.lstat(filename); // 1.
    if (
      !before.isFile() ||
      before.size !== options.size ||
      !isSameManualPath(filename, await files.realpath(filename))
    ) {
      return undefined;
    }
    handle = await files.open(filename, 'r'); // 2.
    const actual = await handle.stat();
    if (!actual.isFile() || actual.size !== options.size || !isSameFile(before, actual))
      return undefined;
    const verified = handle;
    handle = undefined;
    return verified;
  } catch (error) {
    if (isFileError(error, 'ENOENT')) return undefined;
    throw getStorageError();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * 从经过验证且受停止信号约束的本机句柄创建只读流。
 * @param options 已索引文件、实际目录、停止信号和可替换文件操作。
 * @returns 可由调用者消费或销毁的流；不存在时为 undefined。
 * @throws ManualDownloadError 文件无法读取或资料范围已经停止。
 */
export async function openSavedManualStream(
  options: SavedFile & FileOptions & { signal?: AbortSignal },
): Promise<Readable | undefined> {
  const handle = await openSavedFile(options);
  if (!handle) return undefined;
  if (options.signal?.aborted) {
    await handle.close().catch(() => undefined);
    assertManualStoreActive(options.signal);
  }
  const stream = handle.createReadStream({ signal: options.signal });
  // 目录切换可在调用方开始消费前发生；在途错误由调用方消费或销毁时继续处理。
  stream.on('error', () => {});
  return stream;
}

async function hasMatchingContents(
  options: SavedFile & FileOptions & { sha256: string },
): Promise<boolean> {
  const handle = await openSavedFile(options);
  if (!handle) return false;
  try {
    const stream = handle.createReadStream({ autoClose: false });
    return (await verifyPdfStream({ ...options, stream })).kind === 'verified';
  } finally {
    await handle.close();
  }
}

async function publishPdf(options: {
  files: ManualFileSystem;
  directory: string;
  temporary: string;
  productId: string;
  date: string;
  pdf: VerifiedPdf;
  verifyDirectory: () => Promise<void>;
}): Promise<string> {
  const { files, directory, temporary, productId, date, pdf } = options;
  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    await options.verifyDirectory();
    const fileName =
      attempt === 0
        ? pdf.fileName
        : getCollisionFileName({ fileName: pdf.fileName, productId, date, attempt });
    const filename = getSavedPath({ directory, fileName });
    try {
      // 硬链接原子创建最终名称；存在时不会替换条目，也不会让读者看到部分文件。
      await files.link(temporary, filename);
      return fileName;
    } catch (error) {
      if (!isFileError(error, 'EEXIST')) throw getFolderWriteError(error);
      if (await hasMatchingContents({ ...pdf, directory, fileName, fileSystem: files }))
        return fileName;
    }
  }
  throw getStorageError();
}

async function appendChunk(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await writeToFolder(() =>
      handle.write(bytes, offset, bytes.byteLength - offset, null),
    );
    if (bytesWritten <= 0) throw getStorageError();
    offset += bytesWritten;
  }
}

async function removeTemporary(filename: string, files: ManualFileSystem): Promise<void> {
  try {
    await files.unlink(filename);
  } catch (error) {
    if (!isFileError(error, 'ENOENT')) throw getFolderWriteError(error);
  }
}

/**
 * 下载到本次任务的暂存文件，完整校验后原子发布或复用同内容文件。
 * @param options 已确认目录、型号、日期及可替换网络和文件操作。
 * @returns 实际发布的文件名、字节数和摘要。
 * @throws ManualDownloadError 下载或文件操作失败；永不删除已有正式文件。
 */
export async function saveDownloadedManual(
  options: ManualRequestOptions &
    FileOptions & {
      directory: string;
      productId: string;
      model: string;
      date: string;
      verifyDirectory: () => Promise<void>;
    },
): Promise<VerifiedPdf> {
  // 1. 独占暂存。2. 校验并发布文件。3. 清理本次拥有的暂存。
  const files = { ...FILE_SYSTEM, ...options.fileSystem };
  const temporary = path.join(options.directory, `${TEMP_PREFIX}${randomUUID()}${TEMP_EXTENSION}`);
  let handle: FileHandle | undefined;
  let hasTemporary = false;
  let didFail = false;
  try {
    const pdf = await downloadVerifiedPdf({
      ...options,
      append: async (bytes) => {
        // 1.
        if (!handle) {
          await options.verifyDirectory();
          handle = await writeToFolder(() => files.open(temporary, 'wx', FILE_MODE));
          hasTemporary = true;
        }
        assertManualStoreActive(options.signal);
        await appendChunk(handle, bytes);
      },
    });
    await writeToFolder(async () => await handle?.close()); // 2.
    handle = undefined;
    const fileName = await publishPdf({ ...options, files, temporary, pdf });
    return { ...pdf, fileName };
  } catch (error) {
    didFail = true;
    if (error instanceof ManualDownloadError) throw error;
    throw getStorageError();
  } finally {
    await handle?.close().catch(() => undefined); // 3.
    if (hasTemporary) {
      try {
        await removeTemporary(temporary, files);
      } catch (error) {
        // 已有下载失败或范围已切换时保留原原因，避免清理异常掩盖网络失败或取消。
        if (!didFail && !options.signal?.aborted) throw error;
      }
    }
  }
}
