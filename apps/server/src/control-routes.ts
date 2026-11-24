// 处理本机实例的受密钥保护控制动作，供主路由复用，浏览器打开只接受固定服务行为。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../../../packages/core/src/index.ts';
import { CONTROL_HEADER, ROUTES, SERVER_IDENTITY } from './constants.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';
import { hasMatchingSecret } from './session.ts';
import type { RouteContext } from './routes.ts';

/** 控制请求上下文；调用方必须先完成 Host 与 Origin 校验。 */
export type ControlRequest = {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  context: RouteContext;
};

/**
 * 响应完成后再关闭后台，供网页退出和实例控制共用。
 * @param response 当前请求响应。
 * @param close 本实例的有界资源清理函数。
 * @returns 无返回值。
 * @throws 写入响应失败时抛错，后台清理失败不传播给事件循环。
 */
export function scheduleShutdown(response: ServerResponse, close: () => Promise<void>): void {
  // 响应写完后才关闭监听和自有子进程，避免浏览器把成功退出误报为网络失败。
  response.once('finish', () => {
    void close().catch(() => {});
  });
  sendJson({ response, data: { ok: true } });
}

async function openAndConfirmPage(options: ControlRequest): Promise<void> {
  // 1. 创建本次会话观察；2. 在常驻后台派发浏览器；3. 确认 API 到达并清理观察。
  const { context, request, response } = options;
  const body = await readJsonBody(request);
  if (Object.keys(body).length > 0)
    throw new AppError('validation', 'invalid_open_request', 'server');
  const observation = context.sessions.observeLaunch(context.lock.port);
  response.once('close', observation.cancel);
  try {
    // 2. URL 仅由后台生成，控制调用者不能提交任意 URL 或命令。
    await context.dependencies.openBrowser(observation.launchUrl);
    if (!(await observation.hasArrived))
      throw new AppError('process', 'browser_open_timeout', 'server');
    // 3. 不返回启动地址、会话或原始系统输出，只报告本次页面已经读取到状态。
    sendJson({ response, data: { ok: true, port: context.lock.port } });
  } catch (error) {
    if (response.destroyed) return;
    const hasTimedOut = error instanceof AppError && error.subtype === 'browser_open_timeout';
    sendJson({
      response,
      status: hasTimedOut ? 504 : 500,
      data: { reason: hasTimedOut ? 'browser-open-timeout' : 'browser-open-failed' },
    });
  } finally {
    response.removeListener('close', observation.cancel);
    observation.cancel();
  }
}

/**
 * 分派固定的本机控制动作，不接受业务 URL、命令或网页会话授权。
 * @param options 已完成来源校验的请求和当前服务上下文。
 * @returns 是否已经处理该控制路径。
 * @throws 普通控制响应写入错误由主路由处理；打开失败返回固定安全原因。
 */
export async function handleControl(options: ControlRequest): Promise<boolean> {
  const { pathname, request, response, context } = options;
  if (![ROUTES.health, ROUTES.reopen, ROUTES.open, ROUTES.stop].some((route) => route === pathname))
    return false;
  // 控制秘密来自受限本机锁文件；网页 cookie 不能换取新的启动码或打开窗口。
  if (!hasMatchingSecret(request.headers[CONTROL_HEADER], context.lock.secret)) {
    sendFailure({ response, status: 403, reason: 'permission' });
    return true;
  }
  if (pathname === ROUTES.health && request.method === 'GET') {
    sendJson({
      response,
      data: { service: SERVER_IDENTITY, pid: context.lock.pid, port: context.lock.port },
    });
  } else if (pathname === ROUTES.reopen && request.method === 'POST') {
    sendJson({
      response,
      data: { launchUrl: context.sessions.createLaunchUrl(context.lock.port) },
    });
  } else if (pathname === ROUTES.open && request.method === 'POST') {
    await openAndConfirmPage(options);
  } else if (pathname === ROUTES.stop && request.method === 'POST') {
    scheduleShutdown(response, context.close);
  } else sendFailure({ response, status: 405, reason: 'permission' });
  return true;
}
