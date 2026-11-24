// 有界读取和分类 AI 接口返回，由连通测试使用且只返回固定结果类别。
import { asObject, discardResponse, readBoundedResponseText } from '../../core/src/index.ts';
import type { AiModelsResult, AiTestResult } from '../../core/src/index.ts';
import { MAX_MODELS_RESPONSE_BYTES, MAX_RESPONSE_BYTES } from './constants.ts';
import { readUniqueAiModels } from './model-list.ts';

const INVALID_KEY_CODES = new Set(['invalid_api_key', 'authentication_error', 'invalid_token']);
const MODELS_UNSUPPORTED_CODES = new Set([404, 405, 501]);
const MISSING_MODEL_CODES = new Set(['model_not_found', 'deploymentnotfound', 'unknown_model']);
const MISSING_MODEL_MESSAGE =
  /\b(?:model|deployment)\b[^\r\n]{0,200}\b(?:not found|does not exist|is unknown)\b/iu;

type ResponseFailure = 'invalid-key' | 'invalid-address' | 'model-not-found' | 'other-error';

/** 模型探测的内部结果，网络层保留其他错误供通用连通测试使用。 */
export type AiModelProbeResult = {
  kind: Exclude<AiModelsResult['kind'], 'key-required'> | 'other-error';
  models: string[];
};

async function readAiResponse(response: Response, maxBytes: number): Promise<unknown> {
  // 先读取有界正文；传输失败必须由探测层分类，只有 JSON 语法错误会返回空结果。
  const text = await readBoundedResponseText(response, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function getErrorKind(status: number, body: unknown): ResponseFailure {
  const root = asObject(body);
  const error = asObject(root.error);
  const codes = [error.code, error.type, root.code].map((value) =>
    typeof value === 'string' ? value.toLowerCase() : '',
  );
  if (codes.some((code) => INVALID_KEY_CODES.has(code))) return 'invalid-key';
  const message = [error.message, root.error, root.message].find(
    (value) => typeof value === 'string',
  );
  if (
    codes.some((code) => MISSING_MODEL_CODES.has(code)) ||
    ((status === 400 || status === 404 || status === 422) &&
      typeof message === 'string' &&
      MISSING_MODEL_MESSAGE.test(message))
  )
    return 'model-not-found';
  return status === 404 || status === 405 ? 'invalid-address' : 'other-error';
}

async function readClassifiedAiResponse(
  response: Response,
  maxBytes = MAX_RESPONSE_BYTES,
): Promise<{
  body: unknown;
  failure: ResponseFailure | null;
}> {
  // 1. 对无需正文的 HTTP 状态直接分类。2. 有界读取其余响应。
  const { status } = response;
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
    discardResponse(response); // 1.
    return {
      body: null,
      failure: status === 401 || status === 403 ? 'invalid-key' : 'invalid-address',
    };
  }
  const body = await readAiResponse(response, maxBytes); // 2.
  return { body, failure: response.ok ? null : getErrorKind(status, body) };
}

function readModelIds(body: unknown, apiKey: string): string[] | null {
  const data = asObject(body).data;
  if (!Array.isArray(data)) return null;
  return readUniqueAiModels(
    data.map((entry) => asObject(entry).id),
    apiKey,
  );
}

/**
 * 读取模型列表且仅保留有界、安全的 id 字符串。
 * @param options HTTP 响应及用于滤除回显的发送凭据。
 * @returns 模型 ID 或固定失败类别，不返回上游正文。
 * @throws 响应超限或传输中断时由探测层分类。
 */
export async function classifyAiModelsResponse(options: {
  response: Response;
  apiKey: string;
}): Promise<AiModelProbeResult> {
  // 1. 识别不支持列表的 HTTP 状态。2. 读取响应并只投影可见的 ID。
  const { response, apiKey } = options;
  if (MODELS_UNSUPPORTED_CODES.has(response.status)) {
    discardResponse(response); // 1.
    return { kind: 'unsupported', models: [] };
  }
  const { body, failure } = await readClassifiedAiResponse(response, MAX_MODELS_RESPONSE_BYTES); // 2.
  if (failure) return { kind: failure === 'model-not-found' ? 'other-error' : failure, models: [] };
  const models = readModelIds(body, apiKey);
  return models === null ? { kind: 'unsupported', models: [] } : { kind: 'available', models };
}

/**
 * 从有界对话响应判断连通性，失败正文只在内存中参与分类。
 * @param response 最小对话请求的响应。
 * @returns 固定测试类别，不含服务返回字段。
 * @throws 响应超限或传输中断时由探测层分类。
 */
export async function classifyAiChatResponse(response: Response): Promise<AiTestResult> {
  const { body, failure } = await readClassifiedAiResponse(response);
  if (failure) return { kind: failure };
  const { choices } = asObject(body);
  if (Array.isArray(choices) && choices.length > 0) {
    return { kind: 'available' };
  }
  return { kind: 'invalid-address' };
}
