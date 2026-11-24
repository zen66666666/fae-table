// 分派已通过会话校验的单据列表、详情、右栏资料与临时草稿请求。
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppError,
  createTicketDetailSnapshotFailure,
  TICKET_DRAFT_MAX_LENGTH,
  TICKET_DRAFT_SEGMENT,
  TICKET_MANUALS_SEGMENT,
  TICKET_PEOPLE_SEGMENT,
  TICKET_UPDATE_SEGMENT,
} from '../../../packages/core/src/index.ts';
import type { TicketDraft } from '../../../packages/core/src/index.ts';
import { ROUTES, TICKET_PATH_PREFIX } from './constants.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';
import type { ConnectionService } from './connections.ts';

/**
 * 解码单据路径段，格式与列表成员资格由业务读取入口继续校验。
 * @param idPath 尚未解码的单据路径段。
 * @returns 解码后的标识，编码无效时返回空字符串。
 * @throws 无预期错误。
 */
export function decodeTicketId(idPath: string): string {
  try {
    return decodeURIComponent(idPath);
  } catch {
    // 无效编码不能进入 CLI 参数；空标识会经过同一格式检查返回 not-found。
    return '';
  }
}

/**
 * 识别严格的单据子路由形状，拒绝额外路径段。
 * @param pathname 保留原始编码的请求路径。
 * @param suffix 业务允许的固定接口末段。
 * @returns 未解码的单据路径段；其他路径返回 undefined。
 * @throws 无预期错误。
 */
export function readTicketSubrouteId(pathname: string, suffix: string): string | undefined {
  if (!pathname.startsWith(TICKET_PATH_PREFIX)) return undefined;
  const segments = pathname.slice(TICKET_PATH_PREFIX.length).split('/');
  return segments.length === 2 && segments[1] === suffix ? segments[0] : undefined;
}

/**
 * 识别草稿路由的严格路径形状，供会话门禁和后续单据路由使用。
 * @param pathname 保留原始编码的请求路径。
 * @returns 尚未解码的单据路径段；其他路由返回 undefined。
 * @throws 无预期错误。
 */
export function readTicketDraftIdPath(pathname: string): string | undefined {
  return readTicketSubrouteId(pathname, TICKET_DRAFT_SEGMENT);
}

/**
 * 识别单张刷新路由，让它独立于列表刷新调度。
 * @param pathname 保留原始编码的请求路径。
 * @returns 尚未解码的单据路径段；其他路由返回 undefined。
 * @throws 无预期错误。
 */
export function readTicketUpdateIdPath(pathname: string): string | undefined {
  return readTicketSubrouteId(pathname, TICKET_UPDATE_SEGMENT);
}

async function readDraftBody(request: IncomingMessage): Promise<TicketDraft> {
  const body = await readJsonBody(request);
  if (
    Object.keys(body).length !== 1 ||
    typeof body.text !== 'string' ||
    body.text.length > TICKET_DRAFT_MAX_LENGTH
  ) {
    throw new AppError('validation', 'invalid_ticket_draft', 'draft');
  }
  return { text: body.text };
}

async function handleTicketDraft(options: {
  idPath: string;
  request: IncomingMessage;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<void> {
  // 1. 验证方法。2. 锁定当前账号和单据访问。3. 读取或保存草稿。
  const { idPath, request, response, connections } = options;
  const isWrite = request.method === 'PUT';
  if (!isWrite && request.method !== 'GET') {
    // 1.
    sendFailure({ response, status: 405, reason: 'permission' });
    return;
  }
  const access = connections.getTicketDraftAccess(decodeTicketId(idPath)); // 2.
  // 3. 必须在等待正文前捕捉身份版本，保存时由句柄再次验证活跃身份和列表。
  const draft = access && (isWrite ? access.save(await readDraftBody(request)) : access.read());
  sendJson({ response, status: draft ? 200 : 404, data: draft ?? { reason: 'not-found' } });
}

async function handleTicketResource(options: {
  idPath: string;
  resource: typeof TICKET_PEOPLE_SEGMENT | typeof TICKET_MANUALS_SEGMENT;
  request: IncomingMessage;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<void> {
  const { idPath, resource, request, response, connections } = options;
  const isManualRefresh = resource === TICKET_MANUALS_SEGMENT && request.method === 'POST';
  if (request.method !== 'GET' && !isManualRefresh) {
    sendFailure({ response, status: 405, reason: 'permission' });
    return;
  }
  // 型号只能来自当前单据的已读字段，网页不能提供任意查询词。
  if (request.url?.includes('?')) {
    throw new AppError('validation', 'invalid_ticket_resource_query', resource);
  }
  if (isManualRefresh && Object.keys(await readJsonBody(request)).length) {
    throw new AppError('validation', 'invalid_manual_refresh_fields', resource);
  }
  const id = decodeTicketId(idPath);
  const result =
    resource === TICKET_PEOPLE_SEGMENT
      ? connections.getTicketPeople(id)
      : await connections.getTicketManuals(id, { isForced: isManualRefresh });
  sendJson({ response, status: result ? 200 : 404, data: result ?? { reason: 'not-found' } });
}

async function handleTicketUpdate(options: {
  idPath: string;
  request: IncomingMessage;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<void> {
  // 1. 校验方法和查询参数。2. 绑定当前账号并校验正文。3. 只刷新路径指定的单据。
  const { idPath, request, response, connections } = options;
  if (request.method !== 'POST') {
    sendFailure({ response, status: 405, reason: 'permission' });
    return;
  }
  if (request.url?.includes('?'))
    throw new AppError('validation', 'invalid_ticket_update_query', TICKET_UPDATE_SEGMENT); // 1.
  const update = connections.getTicketUpdateAccess(decodeTicketId(idPath)); // 2.
  if (Object.keys(await readJsonBody(request)).length)
    throw new AppError('validation', 'invalid_ticket_update_fields', TICKET_UPDATE_SEGMENT);
  if (!update) {
    sendJson({ response, status: 404, data: createTicketDetailSnapshotFailure('not-found') });
    return;
  }
  const result = await update(); // 3.
  sendJson({ response, status: result.reason === 'not-found' ? 404 : 200, data: result });
}

/**
 * 处理列表、单张刷新、详情、研发人员、手册及草稿请求，调用前完成访问校验。
 * @param options 路径、已识别的草稿单据路径段、请求响应及当前连接服务。
 * @returns 属于单据路由并已响应时为 true，否则为 false。
 * @throws 不处理底层 HTTP 写入异常，由外层统一转换为安全响应。
 */
export async function handleTicketRequest(options: {
  pathname: string;
  draftIdPath: string | undefined;
  request: IncomingMessage;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<boolean> {
  const { pathname, draftIdPath, request, response, connections } = options;
  if (draftIdPath !== undefined) {
    await handleTicketDraft({ idPath: draftIdPath, request, response, connections });
    return true;
  }
  const updateIdPath = readTicketUpdateIdPath(pathname);
  if (updateIdPath !== undefined) {
    await handleTicketUpdate({ idPath: updateIdPath, request, response, connections });
    return true;
  }
  for (const resource of [TICKET_PEOPLE_SEGMENT, TICKET_MANUALS_SEGMENT] as const) {
    const idPath = readTicketSubrouteId(pathname, resource);
    if (idPath !== undefined) {
      await handleTicketResource({ idPath, resource, request, response, connections });
      return true;
    }
  }
  if (request.method !== 'GET') return false;
  if (pathname === ROUTES.tickets) {
    // 列表接口只拿内存结果，查询参数不再具有触发刷新的副作用。
    const result = connections.listTickets();
    sendJson({ response, data: result });
    return true;
  }
  if (!pathname.startsWith(TICKET_PATH_PREFIX)) return false;
  const result = await connections.getTicketDetail(
    decodeTicketId(pathname.slice(TICKET_PATH_PREFIX.length)),
  );
  sendJson({ response, status: result.reason === 'not-found' ? 404 : 200, data: result });
  return true;
}
