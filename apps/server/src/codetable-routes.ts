// 分派已经过同源会话校验的编码表状态与手动刷新请求。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, CODETABLE_ROUTES } from '../../../packages/core/src/index.ts';
import type { CodeTableService } from './codetable-service.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';

/**
 * 交付本机状态或安排无参数的后台刷新，路由从不等待下载。
 * @param options 受保护的请求、响应、路径及当前编码表服务。
 * @returns 已匹配编码表端点时为 true。
 * @throws AppError 请求体无效或携带了不支持的参数。
 */
export async function handleCodeTableRequest(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  codeTable: CodeTableService;
}): Promise<boolean> {
  // 1. 识别固定路径和方法。2. 拒绝自定义查询参数。3. 返回内存中的状态。
  const { pathname, request, response, codeTable } = options;
  const isStatus = pathname === CODETABLE_ROUTES.status; // 1.
  if (!isStatus && pathname !== CODETABLE_ROUTES.refresh) return false;
  if (request.method !== (isStatus ? 'GET' : 'POST')) {
    sendFailure({ response, status: 405, reason: 'permission' });
    return true;
  }
  if (!isStatus && Object.keys(await readJsonBody(request)).length) {
    // 2. 文件和查询词只能来自后台固定配置，避免扩大钉盘读权限。
    throw new AppError('validation', 'invalid_codetable_refresh', 'codetable');
  }
  sendJson({ response, data: isStatus ? codeTable.getStatus() : codeTable.refresh() }); // 3.
  return true;
}
