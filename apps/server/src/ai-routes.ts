// 处理通过会话与来源校验的 AI 配置接口，供后台请求分派器调用。
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readAiConfigInput, readAiModelsInput } from '../../../packages/ai/src/index.ts';
import { AI_ROUTES, AppError, isAiModel } from '../../../packages/core/src/index.ts';
import type { JsonObject } from '../../../packages/core/src/index.ts';
import type { ConnectionService } from './connections.ts';
import { readJsonBody, sendFailure, sendJson } from './http-response.ts';

type AiRouteServices = Pick<ConnectionService, 'ai' | 'getAiStatus' | 'ticketAi'>;

function getModelInput(body: JsonObject): string {
  if (Object.keys(body).length !== 1 || !isAiModel(body.model))
    throw new AppError('validation', 'invalid_ai_fields', 'ai');
  return body.model;
}

async function handleModelRequest(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  connections: AiRouteServices;
}): Promise<void> {
  // 1. 验证唯一允许的请求字段。2. 在同一个后台门禁内变更，避免与其他单据的回答交错。
  const { pathname, request, response, connections } = options;
  const { ai, ticketAi } = connections;
  if (request.url?.includes('?')) throw new AppError('validation', 'invalid_ai_fields', 'ai');
  const body = await readJsonBody(request); // 1.
  if (pathname === AI_ROUTES.switchModel) {
    const model = getModelInput(body);
    const status = await ticketAi.withModelChange(() => ai.switchModel(model)); // 2.
    sendJson({ response, data: status });
    return;
  }
  if (Object.keys(body).length) throw new AppError('validation', 'invalid_ai_fields', 'ai');
  const result = await ticketAi.withModelChange(() => ai.refreshModels()); // 2.
  sendJson({ response, data: result });
}

/**
 * 分派 AI 配置、模型切换和列表刷新，沿用后台的会话与来源校验。
 * @param options 已授权的请求、固定路由路径、响应和 AI 服务。
 * @returns 已响应 AI 路由时为 true，其他路径由请求分派器继续处理。
 * @throws AppError：请求格式或配置无效，外层只返回公开错误类别。
 */
export async function handleAiRequest(options: {
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  connections: AiRouteServices;
}): Promise<boolean> {
  // 1. 匹配固定接口和方法。2. 校验有限的 JSON 参数。3. 只发送脱敏结果。
  const { pathname, request, response, connections } = options;
  const { ai } = connections;
  if (!Object.values(AI_ROUTES).some((route) => pathname === route)) return false;
  const isStatus = pathname === AI_ROUTES.status;
  if (request.method !== (isStatus ? 'GET' : 'POST')) {
    sendFailure({ response, status: 405, reason: 'permission' });
    return true;
  }
  if (isStatus) {
    sendJson({ response, data: await connections.getAiStatus() });
    return true;
  }
  if (pathname === AI_ROUTES.switchModel || pathname === AI_ROUTES.refreshModels) {
    await handleModelRequest(options);
    return true;
  }

  const body = await readJsonBody(request); // 2. 只接受每个接口需要的字段。
  const isEmpty = Object.keys(body).length === 0;
  if (pathname === AI_ROUTES.clear) {
    if (!isEmpty) throw new AppError('validation', 'invalid_ai_fields', 'ai');
    sendJson({
      response,
      data: await connections.ticketAi.withModelChange(() => ai.clearConfig()),
    });
  } else if (pathname === AI_ROUTES.config) {
    const input = readAiConfigInput(body);
    sendJson({
      response,
      data: await connections.ticketAi.withModelChange(() => ai.saveConfig(input)),
    });
  } else if (pathname === AI_ROUTES.models) {
    const input = readAiModelsInput(body);
    sendJson({
      response,
      data: await connections.ticketAi.withModelChange(() => ai.fetchModels(input)),
    });
  } else {
    // 3. 空请求测试当前配置，草稿请求只使用本次填写的接口参数。
    sendJson({
      response,
      data: await ai.testConnection(isEmpty ? undefined : readAiConfigInput(body)),
    });
  }
  return true;
}
