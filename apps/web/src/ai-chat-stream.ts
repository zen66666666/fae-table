// 解码本机 AI 对话事件流，供同源 API 客户端读取逐步生成的文本。
import {
  AI_CHAT_ANSWER_LIMIT,
  asObject,
  isAiModel,
  isObject,
} from '../../../packages/core/src/index.ts';
import type {
  AiChatEvent,
  AiChatOutcome,
  AiChatSummary,
} from '../../../packages/core/src/index.ts';
import { AI_CHAT_OUTCOME_LABELS } from './ai-chat-copy.ts';

const MAX_JSON_ESCAPE_UNITS = 6;
const MAX_EVENT_ENVELOPE_LENGTH = 1024;
// 控制字符或单个代理项最多占六个 JSON 代码单元，要留出合法大增量的转义空间。
const MAX_FRAME_LENGTH = AI_CHAT_ANSWER_LIMIT * MAX_JSON_ESCAPE_UNITS + MAX_EVENT_ENVELOPE_LENGTH;
const FRAME_SEPARATOR = '\n\n';
const DATA_PREFIX = 'data:';
const INVALID_STREAM = 'Invalid workbench AI stream';

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseTrimmed(value: unknown): AiChatSummary['trimmed'] {
  if (value === undefined) return undefined;
  const { records, manualPassages, historyTurns, isOtherContentTrimmed } = asObject(value);
  if (
    !isCount(records) ||
    !isCount(manualPassages) ||
    !isCount(historyTurns) ||
    typeof isOtherContentTrimmed !== 'boolean'
  ) {
    throw new Error(INVALID_STREAM);
  }
  return { records, manualPassages, historyTurns, isOtherContentTrimmed };
}

function parseSummary(value: unknown): AiChatSummary {
  const {
    fieldCount,
    recordCount,
    researcherCount,
    manualPages,
    manualPageCount,
    isManualWithoutText,
    trimmed,
  } = asObject(value);
  if (
    !isCount(fieldCount) ||
    !isCount(recordCount) ||
    !isCount(researcherCount) ||
    !Array.isArray(manualPages) ||
    !manualPages.every((page) => isCount(page) && page > 0) ||
    !(manualPageCount === null || isCount(manualPageCount))
  )
    throw new Error(INVALID_STREAM);
  return {
    fieldCount,
    recordCount,
    researcherCount,
    manualPages,
    manualPageCount,
    trimmed: parseTrimmed(trimmed),
    ...(isManualWithoutText === true ? { isManualWithoutText: true } : {}),
  };
}

function parseEvent(frame: string): AiChatEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith(DATA_PREFIX))
    .map((line) => line.slice(DATA_PREFIX.length).trimStart())
    .join('\n');
  if (!data) return null;
  const { kind, summary, text, outcome, turnId, model, isSaveFailed, runId, startedAt } = asObject(
    JSON.parse(data) as unknown,
  );
  const modelField = isAiModel(model) ? { model } : {};
  if (kind === 'started' && typeof runId === 'string' && runId && isCount(startedAt))
    return { kind, runId, startedAt };
  // 思考事件只读取开始时间，即使收到额外字段，也不把其中的文字交给界面。
  if (kind === 'thinking' && isCount(startedAt)) return { kind, startedAt };
  if (kind === 'context') return { kind, summary: parseSummary(summary), ...modelField };
  if (kind === 'delta' && typeof text === 'string') return { kind, text };
  if (
    kind === 'done' &&
    isObject(outcome) &&
    typeof outcome.kind === 'string' &&
    Object.hasOwn(AI_CHAT_OUTCOME_LABELS, outcome.kind) &&
    (turnId === undefined || typeof turnId === 'string') &&
    (isSaveFailed === undefined || typeof isSaveFailed === 'boolean')
  ) {
    return {
      kind,
      outcome: { kind: outcome.kind } as AiChatOutcome,
      turnId,
      ...modelField,
      ...(isSaveFailed === true ? { isSaveFailed: true } : {}),
    };
  }
  throw new Error(INVALID_STREAM);
}

/** 待读取的同源字节流及事件回调。 */
export type ReadAiChatStreamOptions = {
  body: ReadableStream<Uint8Array>;
  onEvent: (event: AiChatEvent) => void;
};

/**
 * 逐块解析完整的 SSE 事件，拒绝过大的单帧和没有结束事件的响应。
 * 1. 流式解码 UTF-8；2. 取出完整事件；3. 结束或释放读取器。
 * @param options 对话字节流和消费事件的回调。
 * @returns 收到结束事件后完成。
 * @throws 字节流中断或协议异常时抛错；调用方只公开安全错误类别。
 */
export async function readAiChatStream(options: ReadAiChatStreamOptions): Promise<void> {
  const reader = options.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  try {
    while (true) {
      // 1. 保留跨块的多字节字符和半个行结束符。
      const { value, done } = await reader.read();
      pending = (pending + decoder.decode(value, { stream: !done })).replace(/\r\n/gu, '\n');
      // 2. 只解析已经成帧的同源事件，保留下一帧的前缀。
      let separator = pending.indexOf(FRAME_SEPARATOR);
      while (separator >= 0) {
        if (separator > MAX_FRAME_LENGTH) throw new Error(INVALID_STREAM);
        const event = parseEvent(pending.slice(0, separator));
        pending = pending.slice(separator + FRAME_SEPARATOR.length);
        if (event) options.onEvent(event);
        if (event?.kind === 'done') return;
        separator = pending.indexOf(FRAME_SEPARATOR);
      }
      if (done || pending.length > MAX_FRAME_LENGTH) throw new Error(INVALID_STREAM);
    }
  } finally {
    // 3. 结束帧之后不再消费事件；离开页面能及时取消旧响应体。
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
