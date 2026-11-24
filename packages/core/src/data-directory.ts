// 提供本机运行数据目录定位，供配置、后台锁和连接日志共同使用。
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { AppError } from './app-error.ts';

const DATA_DIRECTORY_NAME = 'FAE-Workbench';

/** 数据目录依赖；默认读取当前进程环境并通过本机文件系统创建目录。 */
export type DataDirectoryOptions = {
  environment?: NodeJS.ProcessEnv;
  baseDirectory?: string;
  mkdir?: typeof mkdirSync;
};

/**
 * 定位并创建本机数据目录。
 * @param options 可替换的环境变量、相对路径基准和目录创建函数。
 * @returns 数据目录的绝对路径，优先使用 FAE_DATA_DIR。
 * @throws AppError 默认位置缺少 LOCALAPPDATA；文件系统错误由调用方处理。
 */
export function getDataDir(options: DataDirectoryOptions = {}): string {
  const environment = options.environment ?? process.env;
  const configured = environment.FAE_DATA_DIR;
  if (!configured && !environment.LOCALAPPDATA) {
    throw new AppError('configuration', 'missing_local_app_data', 'data-directory');
  }
  const selected = configured || path.join(environment.LOCALAPPDATA!, DATA_DIRECTORY_NAME);
  const directory = path.resolve(options.baseDirectory ?? process.cwd(), selected);
  (options.mkdir ?? mkdirSync)(directory, { recursive: true });
  return directory;
}
