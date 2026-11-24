// 分派经会话校验的单据 AI 历史、停止接口和独立于网页的回答流。
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AI_ACTIVE_ROUTE,
  AI_CHAT_CLEAR_SEGMENT,
  AI_CHAT_QUESTION_LIMIT,
  AI_CHAT_SEGMENT,
  AI_CHAT_STOP_SEGMENT,
  AppError,
} from '../../../packages/core/src/index.ts';
import type { AiChatEvent } from '../../../packages/core/src/index.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';
import type { TicketAiChat, TicketChatAccess } from './ticket-ai-chat.ts';
import { decodeTicketId, readTicketSubrouteId } from './ticket-routes.ts';

const CLEAR_SUFFIX = '/' + AI_CHAT_CLEAR_SEGMENT;
const STOP_SUFFIX = '/' + AI_CHAT_STOP_SEGMENT;
const STREAM_MIME = 'text/event-stream; charset=utf-8';
const RUN_ID_PATTERN = /^[A-Za-z\d_-]{1,64}$/u;

function sendNotFound(response: ServerResponse): void {
  sendJson({ response, status: 404, data: { reason: 'not-found' } });
}

async function readQuestion(request: IncomingMessage): Promise<string> {
  const body = await readJsonBody(request);
  if (
    Object.keys(body).length !== 1 ||
    typeof body.question !== 'string' ||
    body.question.length > AI_CHAT_QUESTION_LIMIT ||
    !body.question.trim()
  ) {
    throw new AppError('validation', 'invalid_ticket_ai_question', 'ticket-ai-chat');
  }
  return body.question.trim();
}

function answerQuestion(options: {
  access: TicketChatAccess;
  question: string;
  response: ServerResponse;
}): void {
  // 1. 先校验并接收问题。2. 订阅后台回答；浏览器断开只移除订阅。
  const { access, question, response } = options;
  const run = access.ask(question); // 1.
  if (!run) return sendNotFound(response);
  if (response.destroyed) return;
  response.setHeader('Content-Type', STREAM_MIME);
  response.flushHeaders();
  function emit(event: AiChatEvent): void {
    if (!response.destroyed && !response.writableEnded) {
      // JSON 转义使模型文本里的换行不能成为单独的 SSE 消息。
      response.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.kind === 'done') response.end();
    }
  }
  const unsubscribe = run.subscribe(emit); // 2.
  response.once('close', unsubscribe);
  const { runId, startedAt } = run.snapshot;
  emit({ kind: 'started', runId, startedAt });
}

async function stopQuestion(options: {
  access: TicketChatAccess;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const { access, request, response } = options;
  const body = await readJsonBody(request);
  if (
    Object.keys(body).length !== 1 ||
    typeof body.runId !== 'string' ||
    !RUN_ID_PATTERN.test(body.runId)
  )
    throw new AppError('validation', 'invalid_ticket_ai_stop', 'ticket-ai-chat');
  const result = access.stop(body.runId);
  if (result) sendJson({ response, data: result });
  else sendNotFound(response);
}

/**
 * 读取或清空当前单据的本机历史，也可开始有界流式回答。
 * @param options 已完成来源、会话和写请求标记校验的路由依赖。
 * @returns 路由匹配时为 true。
 * @throws AppError 请求格式无效；外层只公开固定错误类别。
 */
export async function handleTicketAiRequest(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  chat: TicketAiChat;
}): Promise<boolean> {
  // 1. 限定路径、方法与账号。2. 由当前句柄读历史或解析唯一问题字段。
  const { pathname, request, response, chat } = options;
  if (pathname === AI_ACTIVE_ROUTE) {
    if (request.method !== 'GET') sendFailure({ response, status: 405, reason: 'permission' });
    else if (request.url?.includes('?'))
      throw new AppError('validation', 'invalid_active_ai_query', 'ticket-ai-chat');
    else sendJson({ response, data: chat.getActiveStatus() });
    return true;
  }
  const suffix = [CLEAR_SUFFIX, STOP_SUFFIX].find((candidate) => pathname.endsWith(candidate));
  const route = suffix ? pathname.slice(0, -suffix.length) : pathname;
  const idPath = readTicketSubrouteId(route, AI_CHAT_SEGMENT); // 1.
  if (idPath === undefined) return false;
  if (request.method !== 'POST' && (suffix || request.method !== 'GET')) {
    sendFailure({ response, status: 405, reason: 'permission' });
    return true;
  }
  if (request.url?.includes('?')) {
    throw new AppError('validation', 'invalid_ticket_ai_query', 'ticket-ai-chat');
  }
  const access = chat.getAccess(decodeTicketId(idPath));
  if (!access) {
    sendNotFound(response);
  } else if (suffix === STOP_SUFFIX) {
    await stopQuestion({ access, request, response });
  } else if (suffix === CLEAR_SUFFIX || request.method === 'GET') {
    if (suffix && Object.keys(await readJsonBody(request)).length) {
      throw new AppError('validation', 'invalid_ticket_ai_clear_fields', 'ticket-ai-chat');
    }
    const history = await (suffix ? access.clear() : access.history()); // 2.
    if (history) sendJson({ response, data: history });
    else sendNotFound(response);
  } else {
    const question = await readQuestion(request);
    answerQuestion({ access, question, response });
  }
  return true;
}
