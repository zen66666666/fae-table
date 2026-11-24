// 调用 Windows 系统 tar 打包工作台，供 npm run package 在网页构建后执行。
import path from 'node:path';
import { AppError, runProcess } from '../packages/core/src/index.ts';
import { copyPackageFiles, preparePackageFiles } from './package-files.ts';
import type { PackageContext, PackageFileSystem } from './package-files.ts';

const ARCHIVE_TIMEOUT_MS = 120_000;
const ARCHIVE_OUTPUT_BYTES = 1024 * 1024;
const ARCHIVE_FORMAT_OPTIONS = 'zip:hdrcharset=UTF-8';
const WINDOWS_TAR_PATH = 'System32/tar.exe';

/** 打包所用文件系统类型，供调用方注入受控文件操作。 */
export type { PackageFileSystem } from './package-files.ts';

/** 打包环境，可替换仓库位置、Windows 环境、文件系统和有界命令执行器。 */
export type PackageOptions = {
  repositoryDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  fileSystem?: PackageFileSystem;
  execute?: typeof runProcess;
};

/** 已生成的压缩包绝对路径和打包文件数，不包含运行数据。 */
export type PackageResult = { archive: string; fileCount: number };

async function compressPackage(context: PackageContext, options: PackageOptions): Promise<void> {
  const environment = options.environment ?? process.env;
  const windowsDirectory = environment.SystemRoot ?? environment.WINDIR;
  if (!windowsDirectory) {
    throw new AppError('configuration', 'windows_tar_unavailable', 'package');
  }
  const result = await (options.execute ?? runProcess)({
    file: path.join(windowsDirectory, WINDOWS_TAR_PATH),
    // 固定 ZIP 文件名编码，避免 Windows 默认代码页把中文双击入口写成乱码。
    args: [
      '-a',
      '-cf',
      context.archive,
      '--options',
      ARCHIVE_FORMAT_OPTIONS,
      '-C',
      context.packageDirectory,
      '.',
    ],
    cwd: context.repositoryDirectory,
    timeoutMs: ARCHIVE_TIMEOUT_MS,
    maxOutputBytes: ARCHIVE_OUTPUT_BYTES,
  });
  if (result.failure || result.exitCode !== 0) {
    throw new AppError('process', 'package_archive_failed', 'package');
  }
}

/**
 * 1. 检查并清理固定输出位置；2. 按白名单复制运行文件；3. 使用系统 tar 生成 ZIP。
 * @param options 可替换的仓库、环境、文件系统和命令执行器，网页须已构建。
 * @returns ZIP 绝对路径和其中的文件数量。
 * @throws AppError：版本、路径或压缩命令无效；文件缺失和复制失败由文件系统报告。
 */
export async function buildSkillPackage(options: PackageOptions = {}): Promise<PackageResult> {
  const context = preparePackageFiles(options); // 1. 不清理其他版本或运行数据。
  const fileCount = copyPackageFiles(context); // 2. 未列入白名单的文件无法进入压缩包。
  await compressPackage(context, options); // 3. 参数数组调用，不交由 shell 解释。
  return { archive: context.archive, fileCount };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify({ status: 'packaged', ...(await buildSkillPackage()) }));
  } catch {
    console.log(JSON.stringify({ status: 'failed', reason: 'package-failed' }));
    process.exitCode = 1;
  }
}
