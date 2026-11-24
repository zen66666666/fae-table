// 准备打包目录和运行文件白名单，由工作台打包命令调用。
import * as fileSystem from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, isObject } from '../packages/core/src/index.ts';

const REPOSITORY_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));
const PACKAGE_NAME = 'fae-workbench';
const STAGING_DIRECTORY = 'dist/package';
const ARCHIVE_DIRECTORY = 'dist';
const ARCHIVE_PREFIX = 'fae-workbench-skill-';
const MANIFEST_FILENAME = 'package.json';
const SOURCE_DIRECTORIES = [
  'apps/server/src',
  'packages/core/src',
  'packages/dingtalk/src',
  'packages/ai/src',
  'packages/codetable/src',
  'packages/manuals/src',
] as const;
const SKILL_FILES = [
  'SKILL.md',
  '启动 FAE 工作台.cmd',
  '退出 FAE 工作台.cmd',
  'scripts/launch-interactive.cmd',
  'scripts/launch.mjs',
  'scripts/launch.ts',
] as const;
const PDFJS_DIRECTORY = 'node_modules/pdfjs-dist';
const PDFJS_FILES = [
  'LICENSE',
  'package.json',
  'legacy/build/pdf.mjs',
  'legacy/build/pdf.worker.mjs',
  'cmaps/LICENSE',
  'standard_fonts/LICENSE_FOXIT',
  'standard_fonts/LICENSE_LIBERATION',
] as const;
const PDFJS_ASSET_DIRECTORIES = [
  { name: 'cmaps', extensions: new Set(['.bcmap']) },
  { name: 'standard_fonts', extensions: new Set(['.pfb', '.ttf']) },
] as const;
const WEB_DIRECTORY = 'dist/web';
const SOURCE_EXTENSIONS = new Set(['.ts']);
const WEB_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.css',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
]);
const EXCLUDED_DIRECTORIES = new Set([
  '.claude',
  '.git',
  '.runtime',
  'node_modules',
  'test',
  'tests',
  '__tests__',
  'fixtures',
]);
const EXCLUDED_SOURCE_SUFFIX = /(?:^|\.)(?:test|spec|d)\.ts$/i;

/** 打包需要的文件操作；可注入替代文件系统，不访问白名单之外的目录。 */
export type PackageFileSystem = Pick<
  typeof fileSystem,
  | 'readFileSync'
  | 'writeFileSync'
  | 'copyFileSync'
  | 'mkdirSync'
  | 'rmSync'
  | 'readdirSync'
  | 'lstatSync'
  | 'realpathSync'
>;

/** 已通过路径扩展校验的临时包目录及目标压缩包。 */
export type PackageContext = {
  repositoryDirectory: string;
  packageDirectory: string;
  archive: string;
  version: string;
  fileSystem: PackageFileSystem;
};

function readVersion(repositoryDirectory: string, files: PackageFileSystem): string {
  const manifest: unknown = JSON.parse(
    files.readFileSync(path.join(repositoryDirectory, MANIFEST_FILENAME), 'utf8'),
  );
  // 版本进入压缩包文件名，严格限制字符以防越过固定的输出目录。
  if (
    !isObject(manifest) ||
    typeof manifest.version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)
  ) {
    throw new AppError('configuration', 'invalid_package_version', 'package');
  }
  return manifest.version;
}

function assertSafePath(context: PackageContext, target: string): void {
  const relative = path.relative(context.repositoryDirectory, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError('policy', 'package_path_outside_repository', 'package');
  }
  let current = context.repositoryDirectory;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      // 拒绝联接点和符号链接，避免清理产物时跟随路径到仓库以外。
      if (context.fileSystem.lstatSync(current).isSymbolicLink()) {
        throw new AppError('policy', 'package_symbolic_link', 'package');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/**
 * 1. 核实仓库及包版本。2. 创建经边界校验的固定暂存目录。
 * @param options 可替换的仓库目录和文件操作。
 * @returns 已准备的包目录、版本和目标压缩包。
 * @throws AppError 版本、输出位置非法或固定目录中发现链接；文件系统错误保持原样。
 */
export function preparePackageFiles(options: {
  repositoryDirectory?: string;
  fileSystem?: PackageFileSystem;
}): PackageContext {
  const files = options.fileSystem ?? fileSystem;
  const repositoryDirectory = files.realpathSync(
    options.repositoryDirectory ?? REPOSITORY_DIRECTORY,
  ); // 1.
  const version = readVersion(repositoryDirectory, files);
  const stagingDirectory = path.resolve(repositoryDirectory, STAGING_DIRECTORY);
  const context = {
    repositoryDirectory,
    packageDirectory: path.join(stagingDirectory, PACKAGE_NAME),
    archive: path.resolve(
      repositoryDirectory,
      ARCHIVE_DIRECTORY,
      `${ARCHIVE_PREFIX}${version}.zip`,
    ),
    version,
    fileSystem: files,
  };
  // 2. 只清理本命令拥有的固定包目录和当前版本压缩包，保留其他构建产物。
  assertSafePath(context, context.packageDirectory);
  assertSafePath(context, context.archive);
  files.rmSync(context.packageDirectory, { recursive: true, force: true });
  files.rmSync(context.archive, { force: true });
  files.mkdirSync(context.packageDirectory, { recursive: true });
  return context;
}

function copyRuntimeFile(options: {
  context: PackageContext;
  source: string;
  destination: string;
}): void {
  const { context, source, destination } = options;
  assertSafePath(context, source);
  assertSafePath(context, destination);
  if (!context.fileSystem.lstatSync(source).isFile()) {
    throw new AppError('configuration', 'package_source_not_file', 'package');
  }
  context.fileSystem.mkdirSync(path.dirname(destination), { recursive: true });
  context.fileSystem.copyFileSync(source, destination);
}

function copyRuntimeDirectory(options: {
  context: PackageContext;
  relative: string;
  extensions: ReadonlySet<string>;
}): number {
  const { context, relative, extensions } = options;
  const source = path.join(context.repositoryDirectory, relative);
  assertSafePath(context, source);
  let fileCount = 0;
  for (const entry of context.fileSystem.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new AppError('policy', 'package_symbolic_link', 'package');
    }
    if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      fileCount += copyRuntimeDirectory({ ...options, relative: child });
    } else if (
      entry.isFile() &&
      extensions.has(path.extname(entry.name).toLowerCase()) &&
      !EXCLUDED_SOURCE_SUFFIX.test(entry.name)
    ) {
      copyRuntimeFile({
        context,
        source: path.join(context.repositoryDirectory, child),
        destination: path.join(context.packageDirectory, child),
      });
      fileCount++;
    }
  }
  return fileCount;
}

function copyPdfTextRuntime(context: PackageContext): number {
  // PDF.js 只负责文本读取；按白名单交付 Node 入口、解析器、字体资源和许可文件。
  for (const file of PDFJS_FILES) {
    const relative = path.join(PDFJS_DIRECTORY, file);
    copyRuntimeFile({
      context,
      source: path.join(context.repositoryDirectory, relative),
      destination: path.join(context.packageDirectory, relative),
    });
  }
  return PDFJS_ASSET_DIRECTORIES.reduce<number>(
    (count, { name, extensions }) =>
      count +
      copyRuntimeDirectory({
        context,
        relative: path.join(PDFJS_DIRECTORY, name),
        extensions,
      }),
    PDFJS_FILES.length,
  );
}

/**
 * 1. 复制双击入口和运行源码。2. 复制网页与 PDF.js。3. 写入最小运行清单。
 * @param context 已通过路径校验的包目录和文件系统。
 * @returns 写入暂存目录的实际文件数。
 * @throws AppError 来源越过仓库、是链接或固定文件缺失；其他文件操作错误保持原样。
 */
export function copyPackageFiles(context: PackageContext): number {
  let fileCount = 0;
  // 1. 启动入口与运行源码。
  for (const relative of SKILL_FILES) {
    copyRuntimeFile({
      context,
      source: path.join(context.repositoryDirectory, 'skill', PACKAGE_NAME, relative),
      destination: path.join(context.packageDirectory, relative),
    });
    fileCount++;
  }
  for (const relative of SOURCE_DIRECTORIES) {
    fileCount += copyRuntimeDirectory({ context, relative, extensions: SOURCE_EXTENSIONS });
  }
  // 2. 网页构建产物与随包提供的 PDF.js 运行文件。
  fileCount += copyRuntimeDirectory({
    context,
    relative: WEB_DIRECTORY,
    extensions: WEB_EXTENSIONS,
  });
  fileCount += copyPdfTextRuntime(context);
  // 3. 原生 Node 运行源码和 PDF.js 文本入口，工作台启动时无需安装依赖。
  context.fileSystem.writeFileSync(
    path.join(context.packageDirectory, MANIFEST_FILENAME),
    `${JSON.stringify({ name: PACKAGE_NAME, version: context.version, type: 'module' }, null, 2)}\n`,
  );
  return fileCount + 1;
}
