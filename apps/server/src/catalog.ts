// 提供本机资料目录的轻量状态、显式检查与独立 PDF 统计，供连接服务使用。
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  asObject,
  getCatalogWriteFailure,
  isCatalogFolderReason,
} from '../../../packages/core/src/index.ts';
import type { CatalogFolderReason, CatalogStatus } from '../../../packages/core/src/index.ts';
import { CATALOG_FILE_SYSTEM, isCatalogPathMissing } from './catalog-file-system.ts';
import type { CatalogFileSystem } from './catalog-file-system.ts';
import { createCatalogPathPolicy, resolveCatalogDirectory } from './catalog-path.ts';
import { scanCatalog } from './catalog-scan.ts';

const WRITE_PROBE_PREFIX = '.fae-catalog-probe-';
type CatalogOperation = 'status' | 'inspect' | 'save' | 'stats';

/** 资料目录检查依赖；目录来源、限制范围、文件系统和取消信号可替换。 */
export type CatalogStatusOptions = {
  folder?: string;
  dataDir: string;
  environment?: NodeJS.ProcessEnv;
  fileSystem?: CatalogFileSystem;
  workbenchRoot?: string;
  signal?: AbortSignal;
};

async function probeWriteAccess(folder: string, fileSystem: CatalogFileSystem): Promise<void> {
  const filename = path.win32.join(folder, `${WRITE_PROBE_PREFIX}${randomUUID()}.tmp`);
  // Windows 的 W_OK 不能证实 ACL 允许写入；wx 保证不会打开或覆盖已有文件。
  const handle = await fileSystem.open(filename, 'wx');
  try {
    await handle.close();
  } finally {
    await fileSystem.unlink(filename);
  }
}

function getCatalogFailure(error: unknown, canProbe: boolean): CatalogFolderReason {
  const { subtype } = asObject(error);
  if (isCatalogFolderReason(subtype)) return subtype;
  if (isCatalogPathMissing(error)) return 'folder-missing';
  const writeFailure = getCatalogWriteFailure(error);
  if (writeFailure === 'folder-not-writable' || (canProbe && writeFailure === 'folder-disk-full'))
    return writeFailure;
  return 'folder-invalid';
}

async function checkCatalogFolder(
  options: CatalogStatusOptions,
  operation: CatalogOperation,
): Promise<CatalogStatus> {
  // 1. 核对真实路径。2. 显式保存或检查时探测写权限。3. 仅为独立统计遍历目录。
  const requested = options.folder?.trim();
  if (!requested)
    return { state: 'action-required', reason: 'folder-required', folder: null, pdfCount: 0 };
  const fileSystem = options.fileSystem ?? CATALOG_FILE_SYSTEM;
  const environment = options.environment ?? process.env;
  const canProbe = operation === 'inspect' || operation === 'save';
  try {
    options.signal?.throwIfAborted();
    const policy = await createCatalogPathPolicy({ ...options, fileSystem, environment }); // 1.
    options.signal?.throwIfAborted();
    const folder = await resolveCatalogDirectory({
      ...options,
      folder: requested,
      fileSystem,
      policy,
      canCreate: operation === 'save',
    });
    options.signal?.throwIfAborted();
    if (canProbe) await probeWriteAccess(folder, fileSystem); // 2.
    const result =
      operation === 'stats'
        ? await scanCatalog({ folder, fileSystem, policy, signal: options.signal }) // 3.
        : { pdfCount: 0 };
    return { state: 'ready', reason: 'none', folder, ...result };
  } catch (error) {
    return {
      state: 'action-required',
      reason: getCatalogFailure(error, canProbe),
      folder: requested,
      pdfCount: 0,
    };
  }
}

/**
 * 仅复核已保存的资料目录是否存在、类型正确且真实路径允许。
 * @param options 当前配置的路径和可替换依赖。
 * @returns 目录状态，PDF 计数由独立后台统计补充。
 * @throws 无预期错误，文件系统失败转换为公开原因。
 */
export async function getCatalogStatus(options: CatalogStatusOptions): Promise<CatalogStatus> {
  return await checkCatalogFolder(options, 'status');
}

/**
 * 明确检查现有目录的可写和可删除性，不创建目录。
 * @param options 用户指定的路径和可替换依赖。
 * @returns 完整可用性结果；计数由独立统计补充。
 * @throws 无预期错误，文件系统失败转换为公开原因。
 */
export async function inspectCatalogFolder(options: CatalogStatusOptions): Promise<CatalogStatus> {
  return await checkCatalogFolder(options, 'inspect');
}

/**
 * 明确保存时检查目录；父级存在才可创建最后一级。
 * @param options 用户指定的路径和可替换依赖。
 * @returns 完整可用性结果，配置是否保存由调用方掌控。
 * @throws 无预期错误，文件系统失败转换为公开原因。
 */
export async function saveCatalogFolder(
  options: CatalogStatusOptions & { folder: string },
): Promise<CatalogStatus> {
  return await checkCatalogFolder(options, 'save');
}

/**
 * 在后台独立读取有界 PDF 计数，重新核对目录边界并且不执行任何写入。
 * @param options 当前资料目录、可替换文件系统和取消信号。
 * @returns 目录状态、已发现的 PDF 数量及受限标记。
 * @throws 无预期错误，文件系统失败转换为公开原因。
 */
export async function getCatalogPdfStats(options: CatalogStatusOptions): Promise<CatalogStatus> {
  return await checkCatalogFolder(options, 'stats');
}
