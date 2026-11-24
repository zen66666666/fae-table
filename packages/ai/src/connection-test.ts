// 获取 OpenAI 兼容模型列表和探测最小对话，供 AI 配置服务使用。
import { AI_MODEL_LIMIT } from '../../core/src/index.ts';
import type {
  AiConfigInput,
  AiModelsInput,
  AiModelsResult,
  AiTestResult,
} from '../../core/src/index.ts';
import { classifyAiChatResponse, classifyAiModelsResponse } from './connection-response.ts';
import type { AiModelProbeResult } from './connection-response.ts';
import { AI_ENDPOINTS, CONNECTION_TIMEOUT_MS, TEST_MAX_TOKENS, TEST_PROMPT } from './constants.ts';
import { getAiEndpointUrl } from './endpoint.ts';

/** AI 连通探测可替换的 HTTP 实现、超时依赖与关停信号。 */
export type AiProbeOptions = {
  fetch?: typeof fetch;
  createTimeoutSignal?: (milliseconds: number) => AbortSignal;
  signal?: AbortSignal;
};

type Probe = {
  requestModels: () => Promise<AiModelProbeResult>;
  requestChat: (model: string) => Promise<AiTestResult>;
  classifyFailure: (error: unknown) => 'invalid-address' | 'timeout' | 'other-error';
};

function createProbe(options: AiProbeOptions & { config: AiModelsInput }): Probe {
  // 1. 设置整次探测的截止时间和认证信息。2. 绑定两种受限请求和错误分类。
  const { address, apiKey } = options.config;
  const send = options.fetch ?? fetch;
  const timeout = (options.createTimeoutSignal ?? AbortSignal.timeout)(CONNECTION_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  // 1. 停止所有重定向，避免把 Key 转发到用户填写的服务器之外。
  const request: RequestInit = { headers, redirect: 'manual', signal };
  return {
    // 2. 列表不触发生成；最小对话只发送固定测试提示。
    requestModels: async () => {
      const response = await send(getAiEndpointUrl(address, AI_ENDPOINTS.models), request);
      return await classifyAiModelsResponse({ response, apiKey });
    },
    requestChat: async (model) => {
      const response = await send(getAiEndpointUrl(address, AI_ENDPOINTS.chat), {
        ...request,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: TEST_MAX_TOKENS,
          messages: [{ role: 'user', content: TEST_PROMPT }],
        }),
      });
      return await classifyAiChatResponse(response);
    },
    classifyFailure: (error) => {
      if (timeout.aborted) return 'timeout';
      return error instanceof TypeError && !signal.aborted ? 'invalid-address' : 'other-error';
    },
  };
}

/**
 * 只请求模型列表，提供经过验证、去重、排序和数量限制的选项。
 * @param options 已校验的实际地址和 Key，以及可替换的网络依赖。
 * @returns 模型名称或固定失败类别。
 * @throws 网络和响应错误均转换为安全结果。
 */
export async function fetchAiModels(
  options: AiProbeOptions & { config: AiModelsInput },
): Promise<AiModelsResult> {
  const probe = createProbe(options);
  try {
    const { kind, models } = await probe.requestModels();
    return {
      kind: kind === 'other-error' ? 'invalid-address' : kind,
      models: models.sort().slice(0, AI_MODEL_LIMIT),
      ...(models.length > AI_MODEL_LIMIT ? { isTruncated: true } : {}),
    };
  } catch (error) {
    return {
      kind: probe.classifyFailure(error) === 'timeout' ? 'timeout' : 'invalid-address',
      models: [],
    };
  }
}

/**
 * 测试指定模型；收到手输模型测试时直接探测对话接口。
 * @param options 已校验的配置、手输模型标识和可替换的网络依赖。
 * @returns 安全连通状态，不发送工单内容，也不返回上游字段。
 * @throws 网络和响应错误均转换为安全结果。
 */
export async function probeAiConnection(
  options: AiProbeOptions & { config: AiConfigInput; isChatOnly: boolean },
): Promise<AiTestResult> {
  // 1. 对没有手输证据的旧测试尝试非生成的模型列表。2. 需要对话时仅发送一次测试。
  const probe = createProbe(options);
  const { model } = options.config;
  try {
    if (!options.isChatOnly) {
      const { kind, models } = await probe.requestModels(); // 1.
      if (kind === 'available')
        return { kind: models.includes(model) ? 'available' : 'model-not-found' };
      if (kind !== 'unsupported') return { kind };
    }
    return await probe.requestChat(model); // 2.
  } catch (error) {
    return { kind: probe.classifyFailure(error) };
  }
}
