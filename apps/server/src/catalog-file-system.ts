// 定义资料目录所需的异步文件操作，供目录校验、扫描和后台依赖注入使用。
import { lstat, mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import { asObject } from '../../../packages/core/src/index.ts';

/** 资料目录专用的文件操作；其他后台文件系统替身无需实现这些方法。 */
export type CatalogFileSystem = {
  lstat: (filename: string) => ReturnType<typeof lstat>;
  mkdir: (directory: string) => Promise<void>;
  open: typeof open;
  opendir: typeof opendir;
  realpath: (filename: string) => Promise<string>;
  unlink: typeof unlink;
};

/** 资料目录虚拟依赖的默认本机实现；mkdir 的默认行为只创建一级。 */
export const CATALOG_FILE_SYSTEM: CatalogFileSystem = {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  unlink,
};

/**
 * 判断文件系统是否明确报告路径不存在。
 * @param error 目录验证或扫描捕获的异常。
 * @returns ENOENT 时为 true；路径上有非目录节点时为 false。
 * @throws 无预期错误。
 */
export function isCatalogPathMissing(error: unknown): boolean {
  return asObject(error).code === 'ENOENT';
}

/**
 * 判断已经发现的子目录或待建目录的父级是否已离开目录树。
 * @param error 目录验证或扫描捕获的异常。
 * @returns 路径不存在或路径中有非目录节点时为 true。
 * @throws 无预期错误。
 */
export function isCatalogPathUnavailable(error: unknown): boolean {
  return isCatalogPathMissing(error) || asObject(error).code === 'ENOTDIR';
}
