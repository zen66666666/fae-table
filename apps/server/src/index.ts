// 本机后台模块：提供单实例启动、连接与 AI 配置、单据只读接口和网页托管。
// startServer 启动后台；getRunningInstance 发现实例；getRunningServer 获取启动地址。
// openRunningServer 确认页面到达；stopServer 关闭实例；openDefaultBrowser 分派本机地址。
import path from 'node:path';
import { AppError } from '../../../packages/core/src/index.ts';
import { resolveServerContext } from './dependencies.ts';
import { acquireInstance, releaseInstanceLock } from './instance-lock.ts';
import { createOwnedServer } from './server-lifecycle.ts';
import type { StartServerOptions, StartedServer } from './types.ts';

/** 后台启动、已有实例控制与可替换环境的公开契约。 */
export type {
  StartServerOptions,
  StartedServer,
  ServerDependencies,
  ServerControlOptions,
  RunningInstance,
} from './types.ts';
/** 查询或关闭已经通过密钥健康验证的实例，不会直接终止锁文件中的进程。 */
export {
  getRunningInstance,
  getRunningServer,
  openRunningServer,
  stopServer,
} from './server-control.ts';
/** 使用操作系统默认浏览器打开经过校验的本机工作台 URL。 */
export { openDefaultBrowser } from './dependencies.ts';
/** 默认浏览器派发可替换的环境和有界进程执行依赖。 */
export type { BrowserOpenOptions } from './dependencies.ts';

/**
 * 启动或复用只监听回环地址的工作台服务。
 * @param options 可选数据目录、浏览器打开函数和环境依赖。
 * @returns 监听端口、一次性启动 URL 和关闭函数。
 * @throws 配置、锁、监听或浏览器启动失败时抛错，失败的新实例会被清理。
 * @example const server = await startServer({ dependencies: { openBrowser: async () => {} } });
 */
async function startPreparedServer(options: StartServerOptions): Promise<StartedServer> {
  // 1. 定位运行目录。2. 获取或复用单实例。3. 输出或打开一次性启动地址。
  const { dependencies, environment, dataDir } = resolveServerContext(options);
  const manualsDirectory = options.manualsDirectory;
  if (
    manualsDirectory !== undefined &&
    (!path.isAbsolute(manualsDirectory) || manualsDirectory.includes('\0'))
  )
    throw new AppError('validation', 'invalid_manuals_directory', 'server');
  // 2. 只有健康且身份匹配的实例可以复用；失效锁回收不会终止锁中的 PID。
  const acquired = await acquireInstance({ dataDir, dependencies });
  let server: StartedServer;
  try {
    server =
      acquired.reused ??
      (await createOwnedServer({
        dataDir,
        manualsDirectory,
        dependencies,
        environment,
        lock: acquired.lock,
      }));
  } catch (error) {
    if (!acquired.reused) releaseInstanceLock({ dataDir, dependencies, lock: acquired.lock });
    throw error;
  }
  try {
    // 3. 无浏览器模式只输出一行机器可读 JSON，便于自动化连接。
    if (environment.FAE_NO_BROWSER === '1') {
      dependencies.output(JSON.stringify({ port: server.port, launchUrl: server.launchUrl }));
    } else await dependencies.openBrowser(server.launchUrl);
    return server;
  } catch (error) {
    // 浏览器启动失败只回收本次新建实例，不影响之前已运行的后台。
    if (!acquired.reused) await server.close();
    throw error;
  }
}

/**
 * 启动或复用回环工作台，并将环境和启动错误转换为统一业务错误。
 * @param options 可选数据目录、浏览器打开函数和环境依赖。
 * @returns 监听端口、一次性启动 URL 和关闭函数。
 * @throws AppError：配置、实例握手、监听或浏览器启动失败。
 */
export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  try {
    return await startPreparedServer(options);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // 原始网络、JSON 与系统异常不能成为命令行入口或网页的公开错误契约。
    throw new AppError('configuration', 'server_start_failed', 'server');
  }
}
