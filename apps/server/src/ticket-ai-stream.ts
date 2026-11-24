// 转发已核实单据的 AI 回答与实际模型，并保存可继续使用的问答。
import { isAiModel } from '../../../packages/core/src/index.ts';
import type {
  AiChatContext,
  AiChatEvent,
  AiChatOutcome,
  AiChatSummary,
  AiChatTurn,
} from '../../../packages/core/src/index.ts';
import type { AiChatStreamOptions, AiService } from '../../../packages/ai/src/index.ts';
import type { TicketAiHistory } from './ticket-ai-history.ts';

const UNREACHABLE: AiChatOutcome = { kind: 'unreachable' };

/** 单据路由传入的已校验问题、取消信号与事件发送动作。 */
export type TicketAiQuestion = {
  question: string;
  signal: AbortSignal;
  emit: (event: AiChatEvent) => void;
};
/** 本轮问答最后交付的一条安全事件。 */
export type TicketAiDone = Extract<AiChatEvent, { kind: 'done' }>;
/** 已停止或离开授权范围的本机对话结果。 */
export const STOPPED_TICKET_AI_ANSWER: TicketAiDone = {
  kind: 'done',
  outcome: { kind: 'stopped' },
};

type StreamCallbacks = Pick<
  AiChatStreamOptions,
  'onModel' | 'onQuestion' | 'onContext' | 'onDelta'
>;
type AnswerBuffer = { question: string; answer: string; summary?: AiChatSummary; model?: string };
type StreamOptions = {
  input: TicketAiQuestion & { key: string };
  context: AiChatContext;
  filter: (value: string) => string;
  isManualWithoutText?: true;
  onQuestion?: (question: string) => void;
  isCurrent: () => boolean;
  ai: Pick<AiService, 'streamAnswer'>;
  history: TicketAiHistory;
  createId: () => string;
};

/**
 * 等待一个对话阶段，在停止时立即结束等待，共享的单据读取或下载仍可继续。
 * @param signal 当前问答的取消信号。
 * @param run 本阶段开始时执行的异步操作。
 * @returns 阶段结果；已经取消时为 undefined。
 * @throws 保留本阶段的异常，由问答路由转换为固定提示。
 */
export function waitForChatStage<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve()
      .then(() => (signal.aborted ? undefined : run()))
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

function bindStreamCallbacks(
  options: Pick<StreamOptions, 'input' | 'isCurrent' | 'isManualWithoutText' | 'onQuestion'>,
  buffer: AnswerBuffer,
): StreamCallbacks {
  const { input, isCurrent, isManualWithoutText } = options;
  return {
    onModel: (model) => {
      // 只接收本次请求实际锁定的模型，切换后不能用当前设置回填旧回答。
      if (buffer.model === undefined && isAiModel(model)) buffer.model = model;
    },
    onQuestion: (question) => {
      buffer.question = question;
      if (isCurrent()) options.onQuestion?.(question);
    },
    onContext: (summary) => {
      if (!isCurrent()) return;
      buffer.summary = { ...summary, isManualWithoutText };
      input.emit({ kind: 'context', summary: buffer.summary, model: buffer.model });
    },
    onDelta: (text) => {
      if (!isCurrent()) return;
      buffer.answer += text;
      input.emit({ kind: 'delta', text });
    },
  };
}

async function saveAnswer(options: {
  stream: StreamOptions;
  turn: Omit<AiChatTurn, 'id'>;
}): Promise<TicketAiDone> {
  const { stream, turn } = options;
  const turnId = stream.createId();
  const isSaved = await stream.history.append(stream.input.key, { ...turn, id: turnId });
  return {
    kind: 'done',
    outcome: { kind: turn.outcome },
    turnId,
    model: turn.model,
    isSaveFailed: isSaved ? undefined : true,
  };
}

/**
 * 1. 取得同单历史。2. 转发实际模型、概要与增量。3. 保存可继续使用的问答。
 * @param options 当前问答、已投影材料及绑定账号的流和历史依赖。
 * @returns 交付给本机网页的最后一条事件。
 * @throws 非预期的依赖异常由上层流路由转换为固定提示。
 */
export async function streamTicketAiAnswer(options: StreamOptions): Promise<TicketAiDone> {
  const { input, history, context, filter, isCurrent, ai } = options;
  const { key, signal } = input;
  const saved = await waitForChatStage(signal, () => history.read(key)); // 1.
  if (!isCurrent()) return STOPPED_TICKET_AI_ANSWER;
  const turns = (saved?.turns ?? []).map((turn) => ({
    ...turn,
    question: filter(turn.question),
    answer: filter(turn.answer),
  }));
  const buffer: AnswerBuffer = { question: filter(input.question), answer: '' };
  const outcome = await waitForChatStage(signal, () =>
    ai.streamAnswer({
      question: buffer.question,
      context,
      history: turns,
      signal,
      ...bindStreamCallbacks(options, buffer),
    }),
  ); // 2.
  if (!isCurrent()) return STOPPED_TICKET_AI_ANSWER;
  const kind = outcome?.kind;
  const { summary, answer, question, model } = buffer;
  if (summary && answer && (kind === 'complete' || kind === 'truncated')) {
    return await saveAnswer({
      stream: options,
      turn: { summary, answer, question, model, outcome: kind },
    }); // 3.
  }
  return {
    kind: 'done',
    outcome: outcome ?? UNREACHABLE,
    model,
    isSaveFailed: saved?.isSaveFailed,
  };
}
