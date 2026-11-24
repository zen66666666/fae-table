// 为当前列表中的单据提供准备和执行接口，依赖外层会话与请求标记检查。
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppError,
  isTicketWriteAction,
  TICKET_WRITE_ROUTES,
  TICKET_WRITE_TEXT_LIMIT,
} from '../../../packages/core/src/index.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';
import { decodeTicketId, readTicketSubrouteId } from './ticket-routes.ts';
import { TICKET_CONFIRMATION_CODE } from './ticket-write-confirmations.ts';
import type { TicketWriteService } from './ticket-write-service.ts';

type RouteInput = {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  writes: TicketWriteService;
};

const WRITE_SUFFIXES = [TICKET_WRITE_ROUTES.prepare, TICKET_WRITE_ROUTES.execute] as const;

function getWriteRoute(
  pathname: string,
): { id: string; operation?: (typeof WRITE_SUFFIXES)[number] } | undefined {
  const operation = WRITE_SUFFIXES.find((part) => pathname.endsWith('/' + part));
  const resource = operation ? pathname.slice(0, -(operation.length + 1)) : pathname;
  const id = readTicketSubrouteId(resource, TICKET_WRITE_ROUTES.resource);
  return id === undefined ? undefined : { id: decodeTicketId(id), operation };
}

/**
 * 识别独立的写回请求，避免可用操作、确认和发送唤醒整轮列表读取。
 * @param pathname 已通过会话校验的请求路径。
 * @param method 当前请求方法。
 * @returns 命中可用操作、确认准备或单据写回时为 true。
 * @throws 无预期错误。
 */
export function isTicketWriteRequest(pathname: string, method?: string): boolean {
  const route = getWriteRoute(pathname);
  if (!route) return false;
  return method === (route.operation ? 'POST' : 'GET');
}

function invalidWriteRequest(): AppError {
  return new AppError('validation', 'invalid_ticket_write_fields', 'ticket-write');
}

function refreshAfterResponse(response: ServerResponse, refresh: () => void): void {
  const schedule = () => {
    response.off('finish', schedule);
    response.off('close', schedule);
    setImmediate(refresh);
  };
  // 响应先交给网页；即使用户关掉页面，已成功写入的单据仍需要后台更新。
  if (response.writableFinished || response.destroyed) schedule();
  else {
    response.once('finish', schedule);
    response.once('close', schedule);
  }
}

/**
 * 分派能力查询、准备与执行请求，仅接受明确允许的字段。
 * @param input 路径、已校验来源的请求及其写回服务。
 * @returns 命中写回路径并响应时为 true。
 * @throws AppError 请求携带额外字段、无效确认码或超限意见。
 */
export async function handleTicketWriteRequest(input: RouteInput): Promise<boolean> {
  // 1. 核对路由和方法。2. 限制请求体字段。3. 执行业务门禁并返回安全结果。
  const { pathname, request, response, writes } = input;
  const route = getWriteRoute(pathname); // 1.
  if (!route) return false;
  const { id, operation } = route;
  if (request.url?.includes('?')) throw invalidWriteRequest();
  if (request.method !== (operation ? 'POST' : 'GET')) {
    sendFailure({ response, status: 405, reason: 'permission' });
    return true;
  }
  if (!operation) {
    sendJson({ response, data: writes.getAvailability(id) });
    return true;
  }
  const body = await readJsonBody(request); // 2.
  if (operation === TICKET_WRITE_ROUTES.prepare) {
    if (
      Object.keys(body).length !== 2 ||
      !isTicketWriteAction(body.action) ||
      typeof body.text !== 'string' ||
      body.text.length > TICKET_WRITE_TEXT_LIMIT
    ) {
      throw invalidWriteRequest();
    }
    sendJson({
      response,
      data: writes.prepare({ id, action: body.action, text: body.text }),
    }); // 3.
  } else {
    if (
      Object.keys(body).length !== 1 ||
      typeof body.code !== 'string' ||
      !TICKET_CONFIRMATION_CODE.test(body.code)
    )
      throw invalidWriteRequest();
    const data = await writes.execute({
      id,
      code: body.code,
      deferRefresh: (refresh) => refreshAfterResponse(response, refresh),
    });
    sendJson({ response, data });
  }
  return true;
}
