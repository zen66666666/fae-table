// 向已校验的 OpenAI 兼容接口发起问答，从有界 SSE 响应中只转发文字。
import { AppError, discardResponse, isObject } from '../../core/src/index.ts';
import type {
  AiChatContext,
  AiChatOutcome,
  AiChatSummary,
  AiChatTurn,
  AiConfigInput,
} from '../../core/src/index.ts';
import { createChatDeadline, waitForChat } from './chat-deadline.ts';
import { AiChatKeyFilter } from './chat-key-filter.ts';
import { clipChatText, createChatPrompt } from './chat-prompt.ts';
import { AiChatSseReader, createChatFormatError } from './chat-sse.ts';
import type { AiChatFrame } from './chat-sse.ts';
import { AI_ENDPOINTS, CHAT_ANSWER_CHARS, MAX_RESPONSE_BYTES } from './constants.ts';
import { getAiEndpointUrl } from './endpoint.ts';
import type { AiProbeOptions } from './connection-test.ts';

/**
 * 一次问答的已核验材料、可取消调用和增量输出约定。
 * @property question 本轮用户问题，只由本机路由验证长度和会话。
 * @property context 已投影且经权限检查的单据材料。
 * @property history 后台已保存的当前会话历史。
 * @property signal 停止按钮、视图切换或服务退出使用的取消信号。
 * @property onModel 在发送和发布材料前通知本次已固定的模型名称。
 * @property onQuestion 将移除凭据后的问题文字交给本机问答历史。
 * @property onContext 输出实际发送的材料计数和手册页码。
 * @property onDelta 逐段交付已经遮蔽凭据的答复。
 */
export type AiChatStreamOptions = {
  question: string;
  context: AiChatContext;
  history: readonly AiChatTurn[];
  signal: AbortSignal;
  onModel?: (model: string) => void;
  onQuestion?: (question: string) => void;
  onContext: (summary: AiChatSummary) => void;
  onDelta: (text: string) => void;
};

type ChatReadOptions = Pick<AiChatStreamOptions, 'onDelta'> & {
  body: NonNullable<Response['body']>;
  apiKey: string;
  deadline: ReturnType<typeof createChatDeadline>;
};
type FrameResult = { text?: string; kind?: 'complete' | 'truncated' | 'service-error' };

function readFrame(frame: AiChatFrame): FrameResult {
  if (frame.event === 'error') return { kind: 'service-error' };
  if (frame.data.trim() === '[DONE]') return { kind: 'complete' };
  if (!frame.data.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(frame.data);
  } catch {
    throw createChatFormatError();
  }
  if (!isObject(value) || value.error) return { kind: 'service-error' };
  const choice = Array.isArray(value.choices) ? value.choices[0] : undefined;
  if (!isObject(choice)) return {};
  // 上游可以发送角色、推理或工具字段；只接受第一条选择的普通内容，不执行函数或工具。
  const content = isObject(choice.delta) ? choice.delta.content : undefined;
  const text = typeof content === 'string' ? content : undefined;
  switch (choice.finish_reason) {
    case 'stop':
      return { text, kind: 'complete' };
    case 'length':
      return { text, kind: 'truncated' };
    case null:
    case undefined:
      return { text };
    default:
      return { kind: 'service-error' };
  }
}

class AnswerStream {
  private readonly options: ChatReadOptions;
  private readonly keyFilter: AiChatKeyFilter;
  private outputLength = 0;

  constructor(options: ChatReadOptions) {
    this.options = options;
    this.keyFilter = new AiChatKeyFilter(options.apiKey);
  }

  consume(frames: Iterable<AiChatFrame>): AiChatOutcome | undefined {
    for (const frame of frames) {
      this.options.deadline.signal.throwIfAborted();
      const { text, kind } = readFrame(frame);
      if (text) {
        this.options.deadline.acceptText();
        if (this.deliver(this.keyFilter.push(text))) return { kind: 'truncated' };
      }
      if (kind !== 'complete') {
        if (kind) return { kind };
        continue;
      }
      if (this.deliver(this.keyFilter.finish())) return { kind: 'truncated' };
      return { kind: this.outputLength ? 'complete' : 'service-error' };
    }
    return undefined;
  }

  private deliver(text: string): boolean {
    const remaining = CHAT_ANSWER_CHARS - this.outputLength;
    const accepted = clipChatText(text, remaining);
    if (accepted) {
      this.outputLength += accepted.length;
      this.options.onDelta(accepted);
      this.options.deadline.signal.throwIfAborted();
    }
    return text.length > remaining;
  }
}

async function readAnswer(options: ChatReadOptions): Promise<AiChatOutcome> {
  // 1. 按字节检查响应上限。2. 交付完整事件的文本。3. 清理上游连接。
  const reader = options.body.getReader();
  const frames = new AiChatSseReader();
  const answer = new AnswerStream(options);
  let received = 0;
  let hasEnded = false;
  try {
    while (true) {
      const chunk = await waitForChat(reader.read(), options.deadline.signal); // 1.
      if (chunk.done) {
        hasEnded = true;
        break;
      }
      received += chunk.value.byteLength;
      if (received > MAX_RESPONSE_BYTES) return { kind: 'truncated' };
      const outcome = answer.consume(frames.push(chunk.value)); // 2.
      if (outcome) return outcome;
    }
    return answer.consume(frames.finish()) ?? { kind: 'service-error' };
  } finally {
    if (!hasEnded) void reader.cancel().catch(() => undefined); // 3.
    reader.releaseLock();
  }
}

function getResponseFailure(response: Response, address: URL): AiChatOutcome | undefined {
  // 手动模式不允许跟随跳转；额外检查响应地址，确保没有悄悄切换接收方。
  if (
    response.redirected ||
    (response.url && response.url !== address.href) ||
    (response.status >= 300 && response.status < 400)
  )
    return { kind: 'unreachable' };
  if (response.status === 401 || response.status === 403) return { kind: 'invalid-key' };
  if (response.status === 429) return { kind: 'rate-limited' };
  if (!response.ok || !response.body) return { kind: 'service-error' };
  return undefined;
}

/**
 * 请求安全的流式回答，仅使用后台配置和本轮经过白名单投影的聊天内容。
 * @param options 已验证配置、问答参数及可替换网络和超时实现。
 * @returns 正常完成、截断、取消或固定故障类别。
 * @throws 预期网络、协议与超时错误均转换为安全状态。
 */
export async function requestAiChat(
  options: AiChatStreamOptions &
    Pick<AiProbeOptions, 'fetch' | 'createTimeoutSignal'> & { config: AiConfigInput },
): Promise<AiChatOutcome> {
  // 1. 组装并发布材料计数。2. 请求同源接口。3. 按截止时间解析并交付回答。
  const { config } = options;
  if (options.signal.aborted) return { kind: 'stopped' };
  const deadline = createChatDeadline(options);
  let response: Response | undefined;
  try {
    deadline.signal.throwIfAborted();
    const prompt = createChatPrompt(options); // 1.
    options.onQuestion?.(prompt.question);
    options.onContext(prompt.summary);
    deadline.signal.throwIfAborted();
    const address = getAiEndpointUrl(config.address, AI_ENDPOINTS.chat); // 2.
    response = await waitForChat(
      (options.fetch ?? fetch)(address, {
        method: 'POST',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
        },
        body: prompt.body,
        signal: deadline.signal,
      }),
      deadline.signal,
    );
    const failure = getResponseFailure(response, address);
    if (failure || !response.body) {
      discardResponse(response);
      return failure ?? { kind: 'service-error' };
    }
    return await readAnswer({
      deadline,
      body: response.body,
      apiKey: config.apiKey,
      onDelta: options.onDelta,
    }); // 3.
  } catch (error) {
    if (response) discardResponse(response);
    return (
      deadline.interruption() ?? {
        kind: response || error instanceof AppError ? 'service-error' : 'unreachable',
      }
    );
  } finally {
    deadline.acceptText();
  }
}
