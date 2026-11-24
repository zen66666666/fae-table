// 返回当前单据快照的图片，调用前由公共路由检查会话、来源和请求标记。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TICKET_IMAGES_SEGMENT } from '../../../packages/core/src/index.ts';
import { TICKET_PATH_PREFIX } from './constants.ts';
import { sendFailure, sendJson } from './http-response.ts';
import { decodeTicketId } from './ticket-routes.ts';
import type { ConnectionService } from './connections.ts';

const IMAGE_ID_PATTERN = /^[\da-f]{64}$/u;
type ImageRoute = { id: string; imageId: string };

function sendImageNotFound(response: ServerResponse): void {
  sendJson({ response, status: 404, data: { reason: 'not-found' } });
}

/**
 * 识别单据图片路由，供会话校验和图片处理共用。
 * @param pathname 未经过路径解码的请求路径。
 * @returns 解码后的单据及图片编号；其他路由返回 undefined。
 * @throws 无预期错误；无效编码交给图片门禁拒绝。
 */
export function readTicketImageRoute(pathname: string): ImageRoute | undefined {
  if (!pathname.startsWith(TICKET_PATH_PREFIX)) return;
  const [id, section, imageId, extra] = pathname.slice(TICKET_PATH_PREFIX.length).split('/');
  if (section !== TICKET_IMAGES_SEGMENT || imageId === undefined || extra !== undefined) return;
  return { id: decodeTicketId(id), imageId: decodeTicketId(imageId) };
}

/**
 * 1. 检查方法和图片编号。2. 通过门禁及共享缓存读取。3. 发送前复核门禁。
 * @param options 已受保护的路由、请求、响应和通用后台依赖。
 * @returns 完成当前响应；无可读图片时返回固定原因和 404。
 * @throws 写入关闭响应时可能由底层报告错误，外部响应原文不会进入错误信息。
 */
export async function handleTicketImageRequest(options: {
  route: ImageRoute;
  request: IncomingMessage;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<void> {
  const { route, request, response, connections } = options;
  if (request.method !== 'GET') {
    // 1.
    sendFailure({ response, status: 405, reason: 'permission' });
    return;
  }
  if (request.url?.includes('?') || !IMAGE_ID_PATTERN.test(route.imageId)) {
    sendImageNotFound(response);
    return;
  }
  const image = await connections.readTicketImage(route); // 2.
  if (response.destroyed) return;
  if (!image || !image.canRead()) {
    // 3.
    sendImageNotFound(response);
    return;
  }
  response.setHeader('Content-Type', image.contentType);
  response.setHeader('Content-Length', image.bytes.length);
  response.end(image.bytes);
}
