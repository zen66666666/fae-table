// 将持久化的手册元数据转为限制路径与版本的只读文本源，供手册存储使用。
import { ensureManualDirectory, isSameManualPath, openSavedManualStream } from './store-files.ts';
import type { ManualFileSystem } from './store-files.ts';
import type { ManualStoreIndex } from './store-index.ts';
import type { ManualTextSource } from './text-types.ts';

/**
 * 只读查找已下载 PDF，同目录与同索引版本再次确认后才打开。
 * @param options 已核实产品编号、索引、目录来源和可替换文件操作。
 * @returns 受限文本源；不存在匹配目录或文件时返回 undefined。
 * @throws ManualDownloadError 无法核实目录、索引或句柄。
 */
export async function getSavedTextSource(options: {
  productId: string;
  index: ManualStoreIndex;
  getDirectory: () => Promise<string>;
  boundDirectory?: string;
  fileSystem?: Partial<ManualFileSystem>;
  signal?: AbortSignal;
}): Promise<ManualTextSource | undefined> {
  // 1. 确认目录与索引归属。2. 打开时重新核实目录和下载版本。
  const { productId, index, boundDirectory, fileSystem, signal } = options;
  const getReadOnlyDirectory = () =>
    ensureManualDirectory({ ...options, canCreateDirectory: false });
  const directory = await getReadOnlyDirectory(); // 1.
  if (boundDirectory && !isSameManualPath(directory, boundDirectory)) return undefined;
  const entry = index.getFileAtDirectory({ productId, directory });
  if (!entry) return undefined;

  return {
    fileName: entry.fileName,
    size: entry.size,
    sha256: entry.sha256,
    open: async () => {
      // 2. 重新下载或用户修改资料位置之后，旧对象不能将文件归属带到新目录。
      if (
        !isSameManualPath(directory, await getReadOnlyDirectory()) ||
        index.getFileAtDirectory({ productId, directory }) !== entry
      )
        return undefined;
      return openSavedManualStream({ ...entry, directory, fileSystem, signal });
    },
  };
}
