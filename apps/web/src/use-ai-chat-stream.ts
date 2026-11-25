// 接收本页发起的对话流，供单据 AI 历史与后台回答状态组合使用。
import { useEffect, useRef, useState } from 'react';
import { AI_CHAT_HISTORY_LIMIT, AI_CHAT_QUESTION_LIMIT } from '../../../packages/core/src/index.ts';
import type { AiChatEvent, AiChatOutcome } from '../../../packages/core/src/index.ts';
import { RequestError } from './api-client.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { AiChatDisplayTurn } from './use-ticket-ai-chat.ts';

type PendingChat = { controller: AbortController; turn: AiChatDisplayTurn };
type StreamOptions = {
  id: string | null;
  client: WorkbenchClient;
  canSend: boolean;
  createController?: () => AbortController;
  now?: () => number;
  onActivityChange?: () => void;
  onDetached: (turn: AiChatDisplayTurn | null) => void;
};
type StreamState = {
  current: AiChatDisplayTurn | null;
  recent: AiChatDisplayTurn[];
  isSaveFailed: boolean | null;
  send: (question: string) => Promise<void>;
  recordStopped: (turn: AiChatDisplayTurn) => void;
  reset: () => void;
};

function createBrowserController(): AbortController {
  return new AbortController();
}

function getChatFailure(error: unknown): AiChatOutcome['kind'] {
  if (!(error instanceof RequestError)) return 'service-error';
  if (error.reason === 'timeout') return 'timeout';
  return error.reason === 'not-found' ? 'detail-unavailable' : 'service-error';
}

function applyEvent(
  turn: AiChatDisplayTurn,
  event: Exclude<AiChatEvent, { kind: 'done' }>,
): AiChatDisplayTurn {
  switch (event.kind) {
    case 'started':
      return { ...turn, id: event.runId, runId: event.runId, startedAt: event.startedAt };
    case 'context':
      return { ...turn, summary: event.summary, model: event.model ?? turn.model };
    case 'thinking':
      if (turn.answer.trim() || turn.thinkingStartedAt !== undefined) return turn;
      return { ...turn, thinkingStartedAt: event.startedAt };
    case 'delta':
      return {
        ...turn,
        answer: turn.answer + event.text,
        thinkingStartedAt: event.text.trim() ? undefined : turn.thinkingStartedAt,
      };
  }
}

/**
 * 追踪本页打开的传输流，离开页面或网络中断时仅释放传输。
 * 1. 记录当前连接；2. 接收事件或恢复后台状态；3. 更新本页临时结果。
 * @param options 单据、客户端、可替换时钟及连接状态回调。
 * @returns 当前流、临时问答、发送及清理操作。
 * @throws 无预期错误；请求异常转换为固定提示或触发后台状态同步。
 */
export function useAiChatStream(options: StreamOptions): StreamState {
  const {
    id,
    client,
    canSend,
    createController = createBrowserController,
    now = Date.now,
    onActivityChange,
    onDetached,
  } = options;
  // 1. 用连接对象隔离更早的传输，防止迟到事件改动新回答。
  const [recent, setRecent] = useState<AiChatDisplayTurn[]>([]);
  const [current, setCurrent] = useState<AiChatDisplayTurn | null>(null);
  const [isSaveFailed, setIsSaveFailed] = useState<boolean | null>(null);
  const active = useRef<PendingChat | null>(null);
  const sequence = useRef(0);

  function saveRecent(turn: AiChatDisplayTurn): void {
    setRecent((previous) =>
      [...previous.filter((entry) => entry.id !== turn.id), turn].slice(-AI_CHAT_HISTORY_LIMIT),
    );
  }

  // 2. 后台确认接受的回答在连接丢失时转回轮询，不附加一个假的失败结果。
  function detach(request: PendingChat): void {
    if (active.current !== request) return;
    active.current = null;
    setCurrent(null);
    onDetached(request.turn.runId ? request.turn : null);
    onActivityChange?.();
  }

  // 3. 正常结束后使用后台标识，后续读回的持久结果会覆盖这一条临时记录。
  function finish(request: PendingChat, event: Extract<AiChatEvent, { kind: 'done' }>): void {
    if (active.current !== request) return;
    active.current = null;
    saveRecent({
      ...request.turn,
      id: event.turnId ?? request.turn.id,
      model: request.turn.model ?? event.model,
      outcome: event.outcome.kind,
    });
    if (event.turnId || event.isSaveFailed !== undefined)
      setIsSaveFailed(event.isSaveFailed ?? false);
    setCurrent(null);
    onActivityChange?.();
  }

  async function send(value: string): Promise<void> {
    const question = value.trim();
    if (!id || !canSend || active.current || !question || question.length > AI_CHAT_QUESTION_LIMIT)
      return;
    // 1. 直到收到后台的 started 事件，这条临时消息不能成为停止请求的目标。
    const request: PendingChat = {
      controller: createController(),
      turn: {
        id: `pending:${++sequence.current}`,
        question,
        answer: '',
        summary: null,
        outcome: null,
        startedAt: now(),
      },
    };
    active.current = request;
    setCurrent(request.turn);
    try {
      // 2. 连接只是观察方式，离开页面不会发送停止请求。
      await client.streamTicketAiChat({
        id,
        question,
        signal: request.controller.signal,
        onEvent: (event) => {
          if (active.current !== request) return;
          if (event.kind === 'done') {
            finish(request, event);
            return;
          }
          request.turn = applyEvent(request.turn, event);
          setCurrent(request.turn);
          if (event.kind === 'started') onActivityChange?.();
        },
      });
      detach(request);
    } catch (error) {
      if (active.current !== request) return;
      if (
        request.turn.runId ||
        (error instanceof RequestError && error.reason === 'ai-already-answering')
      ) {
        detach(request);
      } else {
        // 3. 未被后台确认且未发现重复运行时，显示发起失败并重新同步状态。
        finish(request, { kind: 'done', outcome: { kind: getChatFailure(error) } });
        onDetached(null);
      }
    }
  }

  function recordStopped(turn: AiChatDisplayTurn): void {
    const request = active.current;
    if (request && request.turn.runId === turn.runId) {
      finish(request, { kind: 'done', outcome: { kind: 'stopped' } });
      request.controller.abort();
      return;
    }
    saveRecent({ ...turn, outcome: 'stopped' });
  }

  function reset(): void {
    const request = active.current;
    active.current = null;
    request?.controller.abort();
    setCurrent(null);
    setRecent([]);
    setIsSaveFailed(null);
  }

  useEffect(
    () => () => {
      const request = active.current;
      active.current = null;
      request?.controller.abort();
    },
    [client, id],
  );
  return { recent, current, isSaveFailed, send, recordStopped, reset };
}
