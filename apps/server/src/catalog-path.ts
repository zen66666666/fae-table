// 校验 Windows 资料目录的原路径和真实路径，供读取检查、明确保存和扫描复用。
import path from 'node:path';
import { AppError, asObject } from '../../../packages/core/src/index.ts';
import type { CatalogFolderReason } from '../../../packages/core/src/index.ts';
import { isCatalogPathMissing, isCatalogPathUnavailable } from './catalog-file-system.ts';
import type { CatalogFileSystem } from './catalog-file-system.ts';
import { WORKBENCH_ROOT_DIRECTORY } from './constants.ts';

const WINDOWS_PATH = path.win32;
const DRIVE_DIRECTORY = /^[a-z]:[\\/]/iu;
const INVALID_PATH_CHARACTERS = /[<>:"|?*\x00-\x1f\x7f]/u;
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu;
const SYSTEM_DIRECTORY_NAMES = ['Windows', 'Program Files', 'Program Files (x86)'] as const;
const PROTECTED_ENVIRONMENT_NAMES = [
  ['SystemRoot', 'SYSTEMROOT'],
  ['windir', 'WINDIR'],
  ['ProgramFiles', 'PROGRAMFILES'],
  ['ProgramW6432', 'PROGRAMW6432'],
  ['ProgramFiles(x86)', 'PROGRAMFILES(X86)'],
] as const;

/** 资料路径的受保护范围；禁止路径不进入创建、探针或计数。 */
export type CatalogPathPolicy = { allows: (folder: string) => boolean };

/**
 * 解析 Windows 本机盘符绝对路径，并拒绝设备、UNC、路径别名和留空的目录名。
 * @param value 用户输入或本机系统返回的路径。
 * @returns 规范化的盘符目录；不符合语法时为 null。
 * @throws 无预期错误。
 */
export function normalizeCatalogDirectory(value: string): string | null {
  if (!DRIVE_DIRECTORY.test(value) || INVALID_PATH_CHARACTERS.test(value.slice(2))) return null;
  const segments = value.slice(3).split(/[\\/]/u);
  // Windows 会重写结尾的空格和句点，先拒绝这些别名再比较受保护路径。
  if (segments.some((segment) => DEVICE_NAME.test(segment) || /[. ]$/u.test(segment))) return null;
  return WINDOWS_PATH.resolve(value);
}

function isAtOrBelow(candidate: string, root: string): boolean {
  const relative = WINDOWS_PATH.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..\\') && !WINDOWS_PATH.isAbsolute(relative);
}

function getProtectedPaths(options: {
  dataDir: string;
  workbenchRoot: string;
  environment: NodeJS.ProcessEnv;
}): string[] {
  const { environment } = options;
  const environmentPaths = PROTECTED_ENVIRONMENT_NAMES.map(
    ([name, uppercase]) => environment[name] ?? environment[uppercase],
  );
  const systemDrive = environment.SystemDrive ?? environment.SYSTEMDRIVE;
  const root =
    systemDrive && /^[a-z]:$/iu.test(systemDrive)
      ? `${systemDrive}\\`
      : WINDOWS_PATH.parse(
          environmentPaths.find((value) => value && DRIVE_DIRECTORY.test(value)) ?? 'C:\\',
        ).root;
  return [
    options.dataDir,
    options.workbenchRoot,
    ...environmentPaths,
    ...SYSTEM_DIRECTORY_NAMES.map((name) => WINDOWS_PATH.join(root, name)),
  ].flatMap((folder) => {
    const normalized = folder ? normalizeCatalogDirectory(folder) : null;
    return normalized ? [normalized] : [];
  });
}

/**
 * 确定系统、工作台程序与数据目录的词法位置及联接后的真实位置。
 * @param options 后台所用数据目录、Windows 环境、文件操作及可替换安装根目录。
 * @returns 同时拒绝受保护范围和盘符根目录的路径策略。
 * @throws 无预期错误；无法解析的受保护目录仍按其原路径禁止。
 */
export async function createCatalogPathPolicy(options: {
  dataDir: string;
  environment: NodeJS.ProcessEnv;
  fileSystem: CatalogFileSystem;
  workbenchRoot?: string;
}): Promise<CatalogPathPolicy> {
  const protectedPaths = getProtectedPaths({
    ...options,
    workbenchRoot: options.workbenchRoot ?? WORKBENCH_ROOT_DIRECTORY,
  });
  const resolved = await Promise.allSettled(
    [...new Set(protectedPaths)].map((folder) => options.fileSystem.realpath(folder)),
  );
  for (const entry of resolved) {
    if (entry.status !== 'fulfilled') continue;
    const normalized = normalizeCatalogDirectory(entry.value);
    if (normalized) protectedPaths.push(normalized);
  }
  return {
    allows: (folder) => {
      const directory = normalizeCatalogDirectory(folder);
      return Boolean(
        directory &&
          directory !== WINDOWS_PATH.parse(directory).root &&
          !protectedPaths.some((protectedFolder) => isAtOrBelow(directory, protectedFolder)),
      );
    },
  };
}

function folderError(reason: CatalogFolderReason): AppError {
  return new AppError('validation', reason, 'catalog');
}

function requireAllowed(folder: string, policy: CatalogPathPolicy): void {
  if (!policy.allows(folder)) throw folderError('folder-not-allowed');
}

async function resolveExistingDirectory(options: {
  folder: string;
  policy: CatalogPathPolicy;
  fileSystem: CatalogFileSystem;
}): Promise<string> {
  const { folder, policy, fileSystem } = options;
  const resolved = await fileSystem.realpath(folder);
  requireAllowed(resolved, policy);
  if (!(await fileSystem.lstat(resolved)).isDirectory()) throw folderError('folder-invalid');
  return resolved;
}

async function resolveCatalogParent(options: {
  folder: string;
  policy: CatalogPathPolicy;
  fileSystem: CatalogFileSystem;
}): Promise<string> {
  const { folder, policy, fileSystem } = options;
  const parent = await fileSystem.realpath(WINDOWS_PATH.dirname(folder));
  const directory = normalizeCatalogDirectory(parent);
  if (!directory) throw folderError('folder-not-allowed');
  if (directory !== WINDOWS_PATH.parse(directory).root) requireAllowed(directory, policy);
  if (!(await fileSystem.lstat(parent)).isDirectory()) throw folderError('folder-invalid');
  return parent;
}

async function createLastDirectory(options: {
  folder: string;
  policy: CatalogPathPolicy;
  fileSystem: CatalogFileSystem;
  signal?: AbortSignal;
}): Promise<string> {
  // 1. 验证父级真实位置。2. 仅创建末级。3. 再检查新目录或同时出现的已有目录。
  const { folder, policy, fileSystem } = options;
  let parent: string;
  try {
    parent = await resolveCatalogParent(options); // 1.
  } catch (error) {
    if (isCatalogPathUnavailable(error) || asObject(error).subtype === 'folder-invalid')
      throw folderError('folder-parent-missing');
    throw error;
  }
  const candidate = WINDOWS_PATH.join(parent, WINDOWS_PATH.basename(folder));
  requireAllowed(candidate, policy);
  options.signal?.throwIfAborted();
  try {
    await fileSystem.mkdir(candidate); // 2. 不递归补齐不存在的父级。
  } catch (error) {
    if (isCatalogPathUnavailable(error)) throw folderError('folder-parent-missing');
    if (asObject(error).code !== 'EEXIST') throw error;
  }
  return await resolveExistingDirectory({ ...options, folder: candidate }); // 3.
}

/**
 * 验证现有资料目录；经过用户保存操作时才可创建缺失的最后一级目录。
 * @param options 原始输入、受保护范围、文件操作与是否来自保存请求。
 * @returns 已确认可用的真实绝对目录；创建后的目录仍须完成写入和扫描检查。
 * @throws AppError 不允许路径、父目录缺失、无效目录或文件系统拒绝访问。
 */
export async function resolveCatalogDirectory(options: {
  folder: string;
  policy: CatalogPathPolicy;
  fileSystem: CatalogFileSystem;
  canCreate: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const requested = normalizeCatalogDirectory(options.folder.trim());
  if (!requested) throw folderError('folder-not-allowed');
  requireAllowed(requested, options.policy);
  const checked = { ...options, folder: requested };
  try {
    return await resolveExistingDirectory(checked);
  } catch (error) {
    if (!isCatalogPathMissing(error)) throw error;
  }
  if (options.canCreate) return await createLastDirectory(checked);
  // 某些 Windows 文件系统对子项返回 ENOENT，即使它的直接父级是普通文件。
  try {
    await resolveCatalogParent(checked);
  } catch (error) {
    if (!isCatalogPathMissing(error)) throw error;
  }
  throw folderError('folder-missing');
}
