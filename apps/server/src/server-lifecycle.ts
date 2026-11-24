// 管理后台监听、退出和锁发布，确保只清理本服务拥有的资源。
import type { Server } from 'node:http';
import { AppError } from '../../../packages/core/src/index.ts';
import type { ProcessScope } from '../../../packages/core/src/index.ts';
import { SERVER_HOST, SOCKET_CLOSE_MS } from './constants.ts';
import { ConnectionService } from './connections.ts';
import { publishInstancePort, releaseInstanceLock } from './instance-lock.ts';
import { createRequestHandler } from './routes.ts';
import { SessionStore } from './session.ts';
import type { InstanceLock, ServerDependencies, StartedServer } from './types.ts';

/** 新建实例所需环境；锁已经由调用方独占持有。 */
export type OwnedServerOptions = {
  dataDir: string;
  manualsDirectory?: string;
  lock: InstanceLock;
  dependencies: ServerDependencies;
  environment: NodeJS.ProcessEnv;
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => {
      server.removeListener('listening', ready);
      reject(error);
    };
    const ready = () => {
      server.removeListener('error', failed);
      resolve();
    };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen({ host: SERVER_HOST, port: 0, exclusive: true });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new AppError('configuration', 'invalid_address', 'server');
  return address.port;
}

async function closeHttpServer(server: Server, dependencies: ServerDependencies): Promise<void> {
  if (!server.listening) return;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  // 先停止接收新请求，给已有响应短暂完成机会，再关闭剩余连接保证退出有界。
  const hasClosed = await Promise.race([
    closed.then(() => true),
    dependencies.wait(SOCKET_CLOSE_MS).then(() => false),
  ]);
  if (!hasClosed) server.closeAllConnections();
  await closed;
}

function createCloser(
  options: OwnedServerOptions & {
    server: Server;
    scope: ProcessScope;
    controller: AbortController;
    waitForCleanup: () => Promise<void> | undefined;
  },
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      // 1. 阻止新的连接检查。2. 清理监听和自有进程。3. 释放本实例的锁。
      options.controller.abort();
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      // 2. scope.close 先封闭启动入口，因此未完成的检查无法在退出后重开进程。
      await Promise.allSettled([
        closeHttpServer(options.server, options.dependencies),
        options.scope.close(),
        options.waitForCleanup(),
      ]);
      // 3. 根据随机所有权标识检查锁，绝不删除后来启动实例的锁。
      releaseInstanceLock(options);
    })();
    return closing;
  };
  const onSignal = () => {
    void close().catch(() => {});
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return close;
}

/**
 * 在独占锁保护下创建并启动一个后台实例。
 * @param options 数据目录、锁和可替换环境依赖。
 * @returns 端口、单次启动地址与幂等关闭函数。
 * @throws 配置、监听、锁发布失败时抛错，并清理已创建的资源。
 */
export async function createOwnedServer(options: OwnedServerOptions): Promise<StartedServer> {
  // 1. 创建自有资源和连接服务。2. 绑定路由并监听。3. 发布端口与启动地址。
  const { dependencies, dataDir, environment, lock } = options;
  const scope = dependencies.createScope();
  const controller = new AbortController();
  const server = dependencies.createHttpServer();
  let connections: ConnectionService | undefined;
  const close = createCloser({
    ...options,
    server,
    scope,
    controller,
    waitForCleanup: async () => {
      await Promise.allSettled([
        connections?.codeTable.waitForCleanup(),
        connections?.waitForManualsCleanup(),
        connections?.ticketAi.waitForIdle(),
      ]);
    },
  });
  try {
    const sessions = new SessionStore({ ...dependencies, getPort: () => lock.port });
    connections = new ConnectionService({
      dataDir,
      manualsDirectory: options.manualsDirectory,
      environment,
      dependencies,
      spawn: scope.spawn,
      signal: controller.signal,
      config: dependencies.readConfiguration({ dataDir }),
    });
    // 2. 监听地址固定为回环 IP，端口由系统选择。
    server.on(
      'request',
      createRequestHandler({ lock, dependencies, sessions, connections, close }),
    );
    const port = await listen(server);
    // 3. 只有监听成功后才把端口写入锁，其他启动者不会复用半初始化服务。
    publishInstancePort({ ...options, port });
    return { port, launchUrl: sessions.createLaunchUrl(port), close };
  } catch (error) {
    await close();
    throw error;
  }
}
