// 分派本机控制、会话交换和受保护业务接口，所有失败只返回安全原因类别。
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AI_ACTIVE_ROUTE,
  AppError,
  CATALOG_FOLDER_PICK_ROUTE,
  isCatalogFolderReason,
  isObject,
} from '../../../packages/core/src/index.ts';
import type { ConnectionReason, JsonObject } from '../../../packages/core/src/index.ts';
import { handleAiRequest } from './ai-routes.ts';
import { handleCodeTableRequest } from './codetable-routes.ts';
import { API_PREFIX, ROUTES, SERVER_HOST, TICKET_PATH_PREFIX, WEB_DIRECTORY } from './constants.ts';
import { handleControl, scheduleShutdown } from './control-routes.ts';
import { readJsonBody, sendFailure, sendJson, setSecurityHeaders } from './http-response.ts';
import {
  handleManualFileRequest,
  isManualViewRequest,
  sendManualViewError,
} from './manual-file-routes.ts';
import { hasAllowedOrigin, SessionStore } from './session.ts';
import { serveStaticFile } from './static-files.ts';
import { handleTicketAiRequest } from './ticket-ai-routes.ts';
import { handleTicketImageRequest, readTicketImageRoute } from './ticket-image-routes.ts';
import {
  handleTicketRequest,
  readTicketDraftIdPath,
  readTicketUpdateIdPath,
} from './ticket-routes.ts';
import { handleTicketWriteRequest, isTicketWriteRequest } from './ticket-write-routes.ts';
import type { ConnectionService } from './connections.ts';
import type { InstanceLock, ServerDependencies } from './types.ts';

/** 路由所需服务；关闭函数只控制本实例及其拥有的子进程。 */
export type RouteContext = {
  lock: InstanceLock;
  dependencies: ServerDependencies;
  sessions: SessionStore;
  connections: ConnectionService;
  close: () => Promise<void>;
};

function getErrorReason(error: unknown): ConnectionReason {
  if (!isObject(error)) return 'unknown';
  if (error.subtype === 'profile_invalid' || error.subtype === 'invalid_login_profile')
    return 'profile-invalid';
  if (error.type === 'permission') return 'permission';
  if (error.subtype === 'folder_invalid') return 'folder-invalid';
  if (isCatalogFolderReason(error.subtype)) return error.subtype;
  if (error.subtype === 'ai_key_required') return 'key-required';
  if (error.subtype === 'ai_model_selection_required') return 'model-selection-required';
  if (error.subtype === 'ai_model_test_required') return 'model-test-required';
  if (error.subtype === 'ai_answering') return 'ai-answering';
  if (error.subtype === 'ai_already_answering') return 'ai-already-answering';
  if (error.type === 'configuration' || error.type === 'validation') return 'configuration';
  return 'unknown';
}

function isInputError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.type === 'validation' ||
      error.subtype === 'profile_invalid' ||
      error.subtype === 'folder_invalid')
  );
}

function readStringField(body: JsonObject, key: string): string {
  if (
    Object.keys(body).length !== 1 ||
    typeof body[key] !== 'string' ||
    !body[key].trim() ||
    body[key].includes('\0')
  ) {
    throw new AppError(
      'validation',
      key === 'profile' ? 'profile_invalid' : 'folder_invalid',
      'request',
    );
  }
  return body[key];
}

function sendAccessFailure(options: {
  pathname: string;
  method?: string;
  response: ServerResponse;
  reason: ConnectionReason;
}): void {
  const { pathname, method, response, reason } = options;
  if (isManualViewRequest({ pathname, method })) sendManualViewError({ response, status: 403 });
  else sendFailure({ response, status: 403, reason });
}

async function handlePost(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  context: RouteContext;
}): Promise<void> {
  const { pathname, request, response, context } = options;
  if (pathname === ROUTES.shutdown) {
    scheduleShutdown(response, context.close);
    return;
  }
  const body = await readJsonBody(request);
  if (pathname === CATALOG_FOLDER_PICK_ROUTE) {
    // 选择窗口使用固定脚本，拒绝任何正文或查询值，目录只由系统对话框决定。
    if (Object.keys(body).length || request.url?.includes('?'))
      throw new AppError('validation', 'invalid_folder_pick_fields', 'catalog');
    sendJson({ response, data: await context.connections.pickCatalogFolder() });
    return;
  }
  if (pathname === ROUTES.refreshStatus) {
    if (Object.keys(body).length)
      throw new AppError('validation', 'invalid_status_refresh_fields', 'status');
    sendJson({ response, data: await context.connections.refreshStatus() });
    return;
  }
  if (pathname === ROUTES.refreshTickets) {
    if (Object.keys(body).length)
      throw new AppError('validation', 'invalid_refresh_fields', 'tickets');
    sendJson({ response, data: context.connections.refreshTickets() });
    return;
  }
  if (pathname === ROUTES.login) {
    if (
      Object.keys(body).some((key) => key !== 'profile') ||
      (body.profile !== undefined && typeof body.profile !== 'string')
    ) {
      throw new AppError('validation', 'invalid_login_fields', 'login');
    }
    sendJson({
      response,
      data: await context.connections.login(body.profile as string | undefined),
    });
  } else if (pathname === ROUTES.profile) {
    sendJson({
      response,
      data: await context.connections.selectProfile(readStringField(body, 'profile')),
    });
  } else if (pathname === ROUTES.folder) {
    sendJson({
      response,
      data: await context.connections.setCatalogFolder(readStringField(body, 'folder')),
    });
  } else sendFailure({ response, status: 404, reason: 'configuration' });
}

async function handleApi(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  context: RouteContext;
}): Promise<void> {
  const { pathname, request, response, context } = options;
  const draftIdPath = readTicketDraftIdPath(pathname);
  const imageRoute = readTicketImageRoute(pathname);
  const failure = context.sessions.getApiFailure(
    request,
    draftIdPath !== undefined || imageRoute !== undefined || pathname === AI_ACTIVE_ROUTE,
  );
  if (failure) {
    sendAccessFailure({ pathname, method: request.method, response, reason: failure });
    return;
  }
  if (imageRoute) {
    await handleTicketImageRequest({
      route: imageRoute,
      request,
      response,
      connections: context.connections,
    });
    return;
  }
  // 缓存查询和单张刷新不能唤醒整轮预读，避免间接调用额外的钉钉命令。
  if (
    !isTicketWriteRequest(pathname, request.method) &&
    readTicketUpdateIdPath(pathname) === undefined
  )
    context.connections.noteActivity();
  if (pathname === ROUTES.status && request.method === 'GET') {
    const data = await context.connections.getStatus();
    // 只有本次新会话成功收到状态响应，才确认工作台页面已到达；旧标签页不计入。
    response.once('finish', () => context.sessions.confirmApiAccess(request));
    sendJson({ response, data });
  } else if (
    await handleAiRequest({ pathname, request, response, connections: context.connections })
  ) {
    return;
  } else if (
    await handleCodeTableRequest({
      pathname,
      request,
      response,
      codeTable: context.connections.codeTable,
    })
  ) {
    return;
  } else if (
    await handleManualFileRequest({ pathname, request, response, connections: context.connections })
  ) {
    return;
  } else if (
    await handleTicketAiRequest({ pathname, request, response, chat: context.connections.ticketAi })
  ) {
    return;
  } else if (
    await handleTicketWriteRequest({
      pathname,
      request,
      response,
      writes: context.connections.ticketWrites,
    })
  ) {
    return;
  } else if (
    await handleTicketRequest({
      pathname,
      draftIdPath,
      request,
      response,
      connections: context.connections,
    })
  ) {
    return;
  } else if (request.method === 'POST') await handlePost(options);
  else sendFailure({ response, status: 405, reason: 'permission' });
}

async function dispatchRequest(options: {
  request: IncomingMessage;
  response: ServerResponse;
  context: RouteContext;
}): Promise<void> {
  // 1. 校验来源。2. 处理单次启动交换或受保护接口。3. 托管静态构建产物。
  const { request, response, context } = options;
  const requestedPath = (request.url ?? '/').split('?')[0];
  if (!hasAllowedOrigin(request, context.lock.port)) {
    sendAccessFailure({
      pathname: requestedPath,
      method: request.method,
      response,
      reason: 'permission',
    });
    return;
  }
  const url = new URL(request.url ?? '/', `http://${SERVER_HOST}:${context.lock.port}`);
  // URL 会折叠点路径；单据标识须先按原始路径校验，防止无效标识落入其他路由。
  const pathname = requestedPath.startsWith(TICKET_PATH_PREFIX) ? requestedPath : url.pathname;
  const route = { ...options, pathname, url };
  // 2. Origin 和 Host 检查同样覆盖本机控制接口，拒绝浏览器跨站控制。
  if (await handleControl(route)) return;
  if (pathname.startsWith(API_PREFIX)) return await handleApi(route);
  if (url.pathname === ROUTES.launch && request.method === 'GET') {
    if (!context.sessions.consumeLaunchCode(url.searchParams.get('code'), response)) {
      sendFailure({ response, status: 403, reason: 'permission' });
      return;
    }
    context.connections.noteActivity();
    response.writeHead(303, { Location: '/' });
    response.end();
    return;
  }
  // 3. 静态资源只能 GET，所有业务读取仍需经过受保护的 API。
  if (request.method !== 'GET') return sendFailure({ response, status: 405, reason: 'permission' });
  serveStaticFile({
    pathname: url.pathname,
    webDirectory: WEB_DIRECTORY,
    fileSystem: context.dependencies.fileSystem,
    response,
  });
}

/**
 * 创建不泄露异常正文的异步 HTTP 请求处理器。
 * @param context 本实例的锁、会话、连接服务和关闭函数。
 * @returns 供 Node http.createServer 使用的回调。
 * @throws 请求错误转换为固定 JSON 响应，不向事件循环抛出。
 */
export function createRequestHandler(
  context: RouteContext,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    setSecurityHeaders(response);
    void dispatchRequest({ request, response, context }).catch((error: unknown) => {
      if (response.headersSent || response.destroyed) return;
      const reason = getErrorReason(error);
      sendFailure({
        response,
        status:
          reason === 'ai-answering' || reason === 'ai-already-answering'
            ? 409
            : isInputError(error)
              ? 400
              : 500,
        reason,
      });
    });
  };
}
