// 异步统计已验证资料目录的 PDF 数量，目录大小不会把整个列表读入内存。
import path from 'node:path';
import { getCatalogWriteFailure } from '../../../packages/core/src/index.ts';
import { PDF_EXTENSION } from './constants.ts';
import { isCatalogPathUnavailable } from './catalog-file-system.ts';
import type { CatalogFileSystem } from './catalog-file-system.ts';
import type { CatalogPathPolicy } from './catalog-path.ts';

const MAX_CATALOG_DEPTH = 8;
const MAX_CATALOG_ENTRIES = 10_000;

type FolderEntry = { folder: string; depth: number };
type ScanState = {
  pending: FolderEntry[];
  visited: number;
  pdfCount: number;
  isLimited: boolean;
  hasMoreEntries: boolean;
};
type ScanOptions = {
  fileSystem: CatalogFileSystem;
  policy: CatalogPathPolicy;
  signal?: AbortSignal;
};

async function canScanChild(options: ScanOptions & { folder: string }): Promise<boolean> {
  const resolved = await options.fileSystem.realpath(options.folder);
  // 避免跟随节点类型未识别出的 Windows 联接点，也不走进受保护子目录。
  return options.policy.allows(resolved) && !path.win32.relative(options.folder, resolved);
}

async function scanFolder(
  options: ScanOptions & { entry: FolderEntry; state: ScanState },
): Promise<void> {
  const { fileSystem, entry, policy, signal, state } = options;
  if (entry.depth > 0 && !(await canScanChild({ ...options, folder: entry.folder }))) return;
  const directory = await fileSystem.opendir(entry.folder);
  try {
    while (state.visited < MAX_CATALOG_ENTRIES) {
      signal?.throwIfAborted();
      const child = await directory.read();
      if (!child) return;
      state.visited++;
      if (child.isSymbolicLink()) continue;
      if (child.isFile() && path.win32.extname(child.name).toLowerCase() === PDF_EXTENSION)
        state.pdfCount++;
      if (child.isDirectory()) {
        const folder = path.win32.join(entry.folder, child.name);
        if (!policy.allows(folder)) continue;
        if (entry.depth >= MAX_CATALOG_DEPTH) state.isLimited = true;
        else state.pending.push({ folder, depth: entry.depth + 1 });
      }
    }
    // 只看一条但不计入扫描，也不打开更多目录，确认能否显示“超过上限”。
    signal?.throwIfAborted();
    state.hasMoreEntries = (await directory.read()) !== null;
    if (state.hasMoreEntries || state.pending.length) state.isLimited = true;
  } finally {
    await directory.close();
  }
}

/**
 * 从已验证位置计数 PDF，只读取目录项。
 * @param options 真实根目录、受保护路径检查以及可替换文件系统和停止信号。
 * @returns 已发现数量；达到深度或条目上限时返回下界标记。
 * @throws 目录消失、无法读取或服务停止，调用方只返回安全状态。
 */
export async function scanCatalog(
  options: ScanOptions & { folder: string },
): Promise<{ pdfCount: number; isPdfCountLimited?: boolean; pdfCountLimit?: number }> {
  // 1. 按目录逐个读取，上限内保留待扫列表。2. 达到条目上限后立即结束。
  const state: ScanState = {
    pending: [{ folder: options.folder, depth: 0 }],
    visited: 0,
    pdfCount: 0,
    isLimited: false,
    hasMoreEntries: false,
  };
  while (state.pending.length && state.visited < MAX_CATALOG_ENTRIES) {
    options.signal?.throwIfAborted();
    const entry = state.pending.pop()!;
    try {
      await scanFolder({ ...options, state, entry }); // 1.
    } catch (error) {
      if (entry.depth === 0 || options.signal?.aborted) throw error;
      if (isCatalogPathUnavailable(error)) continue;
      if (getCatalogWriteFailure(error) !== 'folder-not-writable') throw error;
      // 子目录的权限不影响所选根目录，仅提示计数可能不完整。
      state.isLimited = true;
    }
  }
  return {
    pdfCount: state.pdfCount,
    ...(state.isLimited ? { isPdfCountLimited: true } : {}),
    ...(state.hasMoreEntries ? { pdfCountLimit: MAX_CATALOG_ENTRIES } : {}),
  }; // 2.
}
