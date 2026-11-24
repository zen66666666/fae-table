// 处理已授权的手册文件查看、重新下载与打开本机目录，供主路由分派。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import {
  AppError,
  MANUALS_ROUTES,
  TICKET_MANUAL_MODEL_PARAMETER,
  TICKET_MANUAL_REDOWNLOAD_SEGMENT,
  TICKET_MANUAL_VIEW_SEGMENT,
  TICKET_MANUALS_SEGMENT,
} from '../../../packages/core/src/index.ts';
import { TICKET_PATH_PREFIX } from './constants.ts';
import type { ConnectionService } from './connections.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';
import { decodeTicketId } from './ticket-routes.ts';

const PDF_TYPE = 'application/pdf';
const PDF_POLICY = "frame-ancestors 'none'; base-uri 'none'";
const DEFAULT_PDF_NAME = 'manual.pdf';
const ERROR_PAGE_TITLE = '无法打开手册';
const ERROR_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${ERROR_PAGE_TITLE}</title></head><body><h1>${ERROR_PAGE_TITLE}</h1><p>请返回工作台后重新打开。</p></body></html>`;

type FileAction = typeof TICKET_MANUAL_VIEW_SEGMENT | typeof TICKET_MANUAL_REDOWNLOAD_SEGMENT;

function readModelSelection(url: string | undefined): { model?: string } | undefined {
  if (!url?.includes('?')) return {};
  const rawQuery = url.slice(url.indexOf('?') + 1);
  const params = new URLSearchParams(rawQuery);
  const model = params.get(TICKET_MANUAL_MODEL_PARAMETER);
  return params.size === 1 && model?.trim() ? { model } : undefined;
}

function readFileAction(pathname: string): { idPath: string; action: FileAction } | undefined {
  if (!pathname.startsWith(TICKET_PATH_PREFIX)) return undefined;
  const segments = pathname.slice(TICKET_PATH_PREFIX.length).split('/');
  const [id, resource, action] = segments;
  if (segments.length !== 3 || resource !== TICKET_MANUALS_SEGMENT) return undefined;
  if (action === TICKET_MANUAL_VIEW_SEGMENT || action === TICKET_MANUAL_REDOWNLOAD_SEGMENT)
    return { idPath: id, action };
  return undefined;
}

/**
 * 判断受保护请求是否为浏览器直接打开的 PDF 查看页。
 * @param options 未折叠的请求路径与方法。
 * @returns 只对固定 GET 查看路由返回 true。
 * @throws 无预期错误。
 */
export function isManualViewRequest(options: { pathname: string; method?: string }): boolean {
  return (
    options.method === 'GET' &&
    readFileAction(options.pathname)?.action === TICKET_MANUAL_VIEW_SEGMENT
  );
}

/**
 * 向直接打开的手册页面提供固定中文错误，适用于安全门禁和本机文件失效。
 * @param options 当前响应和对应的 HTTP 失败状态。
 * @returns 错误页发送完毕，断开的连接保持关闭。
 * @throws 底层 HTTP 写入错误由主路由处理。
 */
export function sendManualViewError(options: { response: ServerResponse; status: number }): void {
  const { response, status } = options;
  if (response.destroyed || response.headersSent) return;
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(ERROR_PAGE);
}

function getPdfDisposition(fileName: string): string {
  const cleanName = fileName && !/[\\/\x00-\x1f\x7f]/u.test(fileName) ? fileName : DEFAULT_PDF_NAME;
  let encoded = DEFAULT_PDF_NAME;
  try {
    encoded = encodeURIComponent(cleanName).replace(
      /['()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  } catch {
    // 无法编码的损坏文件名使用固定回退，仍可打开有效文件。
  }
  // 固定 ASCII 回退保留兼容性，中文名称只进入 RFC 5987 的编码字段。
  return `inline; filename="${DEFAULT_PDF_NAME}"; filename*=UTF-8''${encoded}`;
}

async function viewManualFile(options: {
  id: string;
  model?: string;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<void> {
  // 1. 只取得已验证的当前单据 PDF。2. 从文件流发送。3. 断开或发送失败时释放文件句柄。
  const { id, model, response, connections } = options;
  const view = await connections.getTicketManualView(id, model).catch(() => null); // 1.
  if (!view) return sendManualViewError({ response, status: 404 });
  try {
    if (response.destroyed) return;
    if (!Number.isSafeInteger(view.size) || view.size <= 0)
      return sendManualViewError({ response, status: 404 });
    response.writeHead(200, {
      'Content-Type': PDF_TYPE,
      'Content-Length': view.size,
      'Content-Disposition': getPdfDisposition(view.fileName),
      // 浏览器在顶层加载 PDF 阅读器；保留禁止跨页面嵌入的限制。
      'Content-Security-Policy': PDF_POLICY,
    });
    await pipeline(view.stream, response); // 2.
  } catch {
    sendManualViewError({ response, status: 404 });
  } finally {
    view.stream.destroy(); // 3. 客户端在打开文件期间离开时也必须关闭。
  }
}

/**
 * 处理手册文件操作；调用方须先完成 Host、Origin、会话和写请求标记校验。
 * @param options 原始路径、请求、响应及当前连接服务。
 * @returns 该固定路由已处理为 true，其他路径为 false。
 * @throws 请求参数或本机分派失败由外层转换为安全响应。
 */
export async function handleManualFileRequest(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  connections: ConnectionService;
}): Promise<boolean> {
  // 1. 限制固定路径和方法。2. 校验空写参数。3. 分派本机文件服务。
  const { pathname, request, response, connections } = options;
  const isFolderAction = pathname === MANUALS_ROUTES.openFolder;
  const file = readFileAction(pathname); // 1.
  if (!isFolderAction && !file) return false;
  const isView = file?.action === TICKET_MANUAL_VIEW_SEGMENT;
  if (request.method !== (isView ? 'GET' : 'POST')) {
    sendFailure({ response, status: 405, reason: 'permission' });
    return true;
  }
  const selection = readModelSelection(request.url);
  if (!selection || (isFolderAction && selection.model !== undefined)) {
    if (!isView) throw new AppError('validation', 'invalid_manual_file_fields', 'manuals');
    sendManualViewError({ response, status: 400 });
    return true;
  }
  if (!isView && Object.keys(await readJsonBody(request)).length)
    // 2.
    throw new AppError('validation', 'invalid_manual_file_fields', 'manuals');
  if (file) {
    const id = decodeTicketId(file.idPath);
    if (isView)
      await viewManualFile({ id, ...selection, connections, response }); // 3.
    else {
      const result = await connections.redownloadTicketManual(id, selection.model);
      sendJson({ response, status: result ? 200 : 404, data: result ?? { reason: 'not-found' } });
    }
  } else {
    await connections.openManualsFolder();
    sendJson({ response, data: { isOpened: true } });
  }
  return true;
}
