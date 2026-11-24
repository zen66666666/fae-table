// 统一处理后台 HTTP 响应和有界 JSON 请求体，避免原始异常进入网页。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, isObject } from '../../../packages/core/src/index.ts';
import type { ConnectionReason, JsonObject } from '../../../packages/core/src/index.ts';
import { BODY_LIMIT_BYTES, SECURITY_HEADERS } from './constants.ts';

/**
 * 写入禁止缓存及嵌入的安全响应头。
 * @param response 当前 HTTP 响应。
 * @returns 无返回值。
 * @throws 响应已关闭时由 Node 报告写入错误。
 */
export function setSecurityHeaders(response: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

/**
 * 输出结构化 JSON，调用者仅传入公开状态或固定错误类别。
 * @param options HTTP 响应、状态码和 JSON 数据。
 * @returns 无返回值。
 * @throws 数据不能序列化或响应写入失败时抛错。
 */
export function sendJson(options: {
  response: ServerResponse;
  status?: number;
  data: unknown;
}): void {
  options.response.statusCode = options.status ?? 200;
  options.response.setHeader('Content-Type', 'application/json; charset=utf-8');
  options.response.end(JSON.stringify(options.data));
}

/**
 * 返回安全的失败类别，不包含异常正文、路径或进程输出。
 * @param options HTTP 响应、状态码和失败类别。
 * @returns 无返回值。
 * @throws 响应写入失败时抛错。
 */
export function sendFailure(options: {
  response: ServerResponse;
  status: number;
  reason: ConnectionReason;
}): void {
  sendJson({ ...options, data: { reason: options.reason } });
}

/**
 * 读取大小受限的 JSON 对象，拒绝数组和非 JSON 请求。
 * @param request 已通过会话与来源检查的请求。
 * @returns 解析后的对象。
 * @throws AppError：正文过大、无效或不是 JSON 对象。
 */
export async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  if (!request.headers['transfer-encoding'] && !Number(request.headers['content-length'] ?? 0)) {
    return {};
  }
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new AppError('validation', 'invalid_content_type', 'request');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > BODY_LIMIT_BYTES) throw new AppError('validation', 'body_too_large', 'request');
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (isObject(value)) return value;
  } catch {
    // 原始输入可能带业务内容，失败时只返回固定的结构错误。
  }
  throw new AppError('validation', 'invalid_json_body', 'request');
}
