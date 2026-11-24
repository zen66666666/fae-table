// 执行带控制秘密的本机健康与复用握手，供单实例锁协调使用。
import { AppError, isObject } from '../../../packages/core/src/index.ts';
import {
  CONTROL_HEADER,
  CONTROL_TIMEOUT_MS,
  OPEN_CONTROL_TIMEOUT_MS,
  ROUTES,
  SERVER_HOST,
  SERVER_IDENTITY,
} from './constants.ts';
import type { InstanceLock, ServerDependencies, StartedServer } from './types.ts';

async function readControlResponse(response: Response, route: string): Promise<unknown> {
  if (!response.ok && route !== ROUTES.open)
    throw new AppError('configuration', 'instance_unhealthy', 'server');
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new AppError('protocol', 'instance_response_invalid', 'server');
  }
  if (!response.ok) {
    // 打开动作仅允许两个固定原因，不能把服务返回的任意文本变成终端错误信息。
    const hasTimedOut = isObject(result) && result.reason === 'browser-open-timeout';
    throw new AppError(
      'process',
      hasTimedOut ? 'browser_open_timeout' : 'browser_open_failed',
      'server',
    );
  }
  return result;
}

async function callControl(options: {
  lock: InstanceLock;
  route: string;
  method: 'GET' | 'POST';
  dependencies: ServerDependencies;
  timeoutMs?: number;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await options.dependencies.fetch(
      `http://${SERVER_HOST}:${options.lock.port}${options.route}`,
      {
        method: options.method,
        headers: { [CONTROL_HEADER]: options.lock.secret },
        signal: AbortSignal.timeout(options.timeoutMs ?? CONTROL_TIMEOUT_MS),
        redirect: 'error',
      },
    );
  } catch (error) {
    if (options.route === ROUTES.open) {
      const hasTimedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new AppError(
        'process',
        hasTimedOut ? 'browser_open_timeout' : 'browser_open_failed',
        'server',
      );
    }
    throw new AppError('process', 'instance_request_failed', 'server');
  }
  return await readControlResponse(response, options.route);
}

/**
 * 确认锁指向的端口确实属于原工作台实例，PID 存活本身不足以证明锁有效。
 * @param options 原锁和可替换网络依赖。
 * @returns 密钥握手及服务标识、PID、端口全部一致时为 true。
 * @throws 不向调用方传播连接、超时或无效 JSON 错误，统一判为无效实例。
 */
export async function isInstanceHealthy(options: {
  lock: InstanceLock;
  dependencies: ServerDependencies;
}): Promise<boolean> {
  try {
    const health = await callControl({ ...options, route: ROUTES.health, method: 'GET' });
    return (
      isObject(health) &&
      health.service === SERVER_IDENTITY &&
      health.pid === options.lock.pid &&
      health.port === options.lock.port
    );
  } catch {
    return false;
  }
}

/**
 * 向已经确认健康的实例申请新启动码，失败时不回收原锁或创建第二个实例。
 * @param options 已核实的原锁和网络依赖。
 * @returns 复用实例的端口、启动地址和关闭函数。
 * @throws AppError：启动码获取失败或响应结构无效。
 */
export async function reuseHealthyInstance(options: {
  lock: InstanceLock;
  dependencies: ServerDependencies;
}): Promise<StartedServer> {
  // 1. 获取新的单次启动码。2. 验证固定地址。3. 返回仅控制该实例的句柄。
  const launch = await callControl({ ...options, route: ROUTES.reopen, method: 'POST' });
  // 2. 不接受远程地址或其他端口，避免控制响应引导浏览器离开已核实实例。
  const prefix = `http://${SERVER_HOST}:${options.lock.port}${ROUTES.launch}?code=`;
  if (
    !isObject(launch) ||
    typeof launch.launchUrl !== 'string' ||
    !launch.launchUrl.startsWith(prefix)
  ) {
    throw new AppError('protocol', 'invalid_launch_response', 'server');
  }
  // 3. 只调用原实例的受保护接口，不根据锁里的 PID 终止任何系统进程。
  return {
    port: options.lock.port,
    launchUrl: launch.launchUrl,
    close: async () => {
      await stopHealthyInstance(options);
    },
  };
}

/**
 * 通过固定控制接口请求已核实的实例关闭，不使用进程号终止进程。
 * @param options 已通过健康验证的实例锁和可替换网络依赖。
 * @returns 控制请求已被服务接受；资源释放由服务自身完成。
 * @throws AppError：控制请求失败或响应格式不符。
 */
export async function stopHealthyInstance(options: {
  lock: InstanceLock;
  dependencies: ServerDependencies;
}): Promise<void> {
  const result = await callControl({ ...options, route: ROUTES.stop, method: 'POST' });
  if (!isObject(result) || result.ok !== true) {
    throw new AppError('protocol', 'invalid_stop_response', 'server');
  }
}

/**
 * 请求健康后台自行打开固定工作台页面，并等待本次会话成功读取状态。
 * @param options 已核实的实例锁和可替换网络依赖，不接受业务 URL 或命令。
 * @returns 本次页面确认到达的端口；不返回启动码或会话信息。
 * @throws AppError：页面未到达、系统分派失败、服务返回的结果不符合约定。
 */
export async function openHealthyInstance(options: {
  lock: InstanceLock;
  dependencies: ServerDependencies;
}): Promise<number> {
  const result = await callControl({
    ...options,
    route: ROUTES.open,
    method: 'POST',
    timeoutMs: OPEN_CONTROL_TIMEOUT_MS,
  });
  if (!isObject(result) || result.ok !== true || result.port !== options.lock.port)
    throw new AppError('protocol', 'invalid_open_response', 'server');
  return options.lock.port;
}
