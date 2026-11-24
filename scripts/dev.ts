// 提供 npm run dev 的后台启动入口，固定使用仓库运行目录，网页由前置构建生成。
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../apps/server/src/index.ts';
import type { StartedServer } from '../apps/server/src/index.ts';

/** 开发运行数据相对仓库根目录的位置，避免写入用户的正式配置目录。 */
const DEVELOPMENT_DATA_DIRECTORY = '.runtime/app';
const DEVELOPMENT_MANUALS_DIRECTORY = 'FAE-Workbench-dev-manuals';

/** 开发入口可替换的进程环境和后台启动函数，默认使用本机实现。 */
export type DevelopmentOptions = {
  environment?: NodeJS.ProcessEnv;
  start?: typeof startServer;
  getTempDirectory?: typeof tmpdir;
};

/**
 * 为开发运行设置数据目录，并启动或复用本机后台。
 * @param options 可替换的环境变量和服务启动函数。
 * @returns 后台端口、一次性启动地址及关闭函数。
 * @throws AppError：后台启动、实例协调或打开浏览器失败。
 */
export async function runDevelopment(options: DevelopmentOptions = {}): Promise<StartedServer> {
  // 1. 指定开发数据目录；2. 复用后台公开入口处理实例、会话和浏览器。
  const environment = options.environment ?? process.env;
  environment.FAE_DATA_DIR = DEVELOPMENT_DATA_DIRECTORY; // 1. 保持 npm 开发命令的原有目录约定。
  // 手册开发文件始终使用操作系统临时目录，避免写进用户的正式文档目录。
  const manualsDirectory = path.resolve(
    (options.getTempDirectory ?? tmpdir)(),
    DEVELOPMENT_MANUALS_DIRECTORY,
  );
  return await (options.start ?? startServer)({ environment, manualsDirectory }); // 2.
}

if (import.meta.main) await runDevelopment();
