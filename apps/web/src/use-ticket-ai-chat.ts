// 读取单据的问答历史和后台进度，供右栏 AI 助手展示和控制。
import { useCallback, useEffect, useState } from 'react';
import {
  AI_CHAT_ACTIVE_POLL_INTERVAL_MS,
  AI_CHAT_HISTORY_LIMIT,
} from '../../../packages/core/src/index.ts';
import type {
  AiChatActive,
  AiChatHistory,
  AiChatOutcome,
  AiChatSummary,
} from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { useAiChatStream } from './use-ai-chat-stream.ts';
import { useRequestAction } from './use-request-action.ts';
import { useTicketPolling } from './use-ticket-polling.ts';
import { createTicketReadFailure, useTicketRead } from './use-ticket-read.ts';
import type { TicketReadFailure } from './use-ticket-read.ts';

/** 当前窗口可见的一轮问答，进行中的回答可能暂时没有概要或结束状态。 */
export type AiChatDisplayTurn = {
  id: string;
  question: string;
  answer: string;
  summary: AiChatSummary | null;
  outcome: AiChatOutcome['kind'] | null;
  startedAt?: number;
  thinkingStartedAt?: number;
  model?: string;
  runId?: string;
};

/** 当前单据、全局观察状态、同源客户端和可替换时钟。 */
export type TicketAiChatOptions = {
  id: string | null;
  client: WorkbenchClient;
  createController?: () => AbortController;
  now?: () => number;
  clock?: PollingClock;
  isSendBlocked?: boolean;
  isKnownActive?: boolean;
  onActivityChange?: () => void;
};

/** 当前单据可见的问答、读取与进行状态和控制入口。 */
export type TicketAiChatState = {
  turns: AiChatDisplayTurn[];
  current: AiChatDisplayTurn | null;
  isGenerating: boolean;
  isReadingHistory: boolean;
  hasHistoryFailed: boolean;
  hasHistorySaveFailed: boolean;
  hasHistoryClearFailed: boolean;
  isClearingHistory: boolean;
  hasStopFailed: boolean;
  isStopping: boolean;
  canClear: boolean;
  canSend: boolean;
  canStop: boolean;
  reload: () => Promise<void>;
  clear: () => Promise<void>;
  send: (question: string) => Promise<void>;
  stop: () => Promise<void>;
};

type DetachedChat = { turn: AiChatDisplayTurn | null; previousHistory: AiChatHistory | null };

function getActiveTurn(active: AiChatActive | undefined): AiChatDisplayTurn | null {
  if (!active) return null;
  return { ...active, id: active.runId, summary: active.summary ?? null, outcome: null };
}

function mergeTurns(options: {
  stored: AiChatHistory | null;
  recent: AiChatDisplayTurn[];
}): AiChatDisplayTurn[] {
  const stored = options.stored?.turns ?? [];
  const knownIds = new Set(stored.map(({ id }) => id));
  // 持久结果与运行标识相同，取持久版本以免同一问答出现两个气泡。
  const recent = options.recent.filter(({ id }) => !knownIds.has(id));
  const noAnswer = options.stored?.noAnswer;
  // 已在流中看过结果时保留已有气泡；切回这张单据时从内存快照恢复同一个结果。
  if (
    noAnswer &&
    !knownIds.has(noAnswer.runId) &&
    !recent.some(({ id }) => id === noAnswer.runId)
  ) {
    recent.push({
      id: noAnswer.runId,
      question: noAnswer.question,
      answer: '',
      summary: null,
      outcome: 'no-answer',
    });
  }
  return [...stored, ...recent].slice(-AI_CHAT_HISTORY_LIMIT);
}

/**
 * 切换或刷新单据时恢复后台问答，流中断后继续读取进度。
 * 1. 读本机快照；2. 合并流式、快照及停止状态；3. 限定可用操作。
 * @param options 客户端、单据、活动提示与可替换的环境依赖。
 * @returns 历史、当前进度、发送、停止、清空和重载入口。
 * @throws 无预期错误；请求失败转成页面提示。
 */
export function useTicketAiChat(options: TicketAiChatOptions): TicketAiChatState {
  const { id, client, clock, isKnownActive, onActivityChange } = options;
  // 1. 保留最近的成功快照，短暂网络故障不会清空当前问答。
  const load = useCallback(
    () => (id ? client.getTicketAiChat(id) : Promise.resolve({ turns: [] })),
    [client, id],
  );
  const history = useTicketRead<AiChatHistory | TicketReadFailure>({
    load,
    createFailure: createTicketReadFailure,
    isResultRetainedOnFailure: true,
  });
  const stored = history.result && 'turns' in history.result ? history.result : null;
  const [detached, setDetached] = useState<DetachedChat | null>(null);
  const isReattaching = Boolean(
    detached && (stored === null || stored === detached.previousHistory),
  );
  useEffect(() => {
    if (detached && !isReattaching) setDetached(null);
  }, [detached, isReattaching]);

  // 2. 有流时即时接收；切走、刷新或断线后用后台快照重接。
  const generation = useAiChatStream({
    ...options,
    canSend: Boolean(id && stored && !options.isSendBlocked && !isReattaching),
    onDetached: (turn) => {
      setDetached({ turn, previousHistory: stored });
      void history.reload();
    },
    onActivityChange: () => {
      void history.reload();
      onActivityChange?.();
    },
  });
  const turns = mergeTurns({ stored, recent: generation.recent });
  const observed = getActiveTurn(stored?.active);
  const reconnecting = isReattaching ? detached?.turn : null;
  // 重接前先保留同一轮最后收到的思考时间，较早的快照不能把计时退回发送时刻。
  const resumed =
    reconnecting && (!observed || observed.runId === reconnecting.runId) ? reconnecting : observed;
  const pending = generation.current ?? resumed;
  const current = pending && !turns.some(({ id }) => id === pending.id) ? pending : null;
  const isGenerating = Boolean(current || isReattaching || (isKnownActive && !pending));
  useTicketPolling({
    reload: history.reload,
    intervalMs: AI_CHAT_ACTIVE_POLL_INTERVAL_MS,
    isEnabled: Boolean(id && !generation.current && (observed || isKnownActive || isReattaching)),
    clock,
  });

  // 3. 停止只针对明确的后台标识；停掉旧回答不会影响新的回答。
  const stopping = useRequestAction<AiChatDisplayTurn>({
    perform: async (turn) => {
      if (!id || !turn.runId) return;
      const outcome = await client.stopTicketAiChat({ id, runId: turn.runId });
      if (outcome.kind === 'stopped') generation.recordStopped(turn);
      void history.reload();
      onActivityChange?.();
    },
  });
  const clearing = useRequestAction<undefined>({
    perform: async () => {
      if (!id) return;
      const response = await client.clearTicketAiChat(id);
      generation.reset();
      setDetached(null);
      history.acceptResult(response);
      onActivityChange?.();
    },
  });
  const hasHistoryFailed = Boolean(history.result && 'kind' in history.result);
  return {
    turns,
    current,
    isGenerating,
    isReadingHistory: Boolean(id && !stored && history.isLoading),
    hasHistoryFailed,
    hasHistorySaveFailed: generation.isSaveFailed ?? stored?.isSaveFailed === true,
    hasHistoryClearFailed: clearing.reason !== 'none',
    isClearingHistory: clearing.isPending,
    hasStopFailed: stopping.reason !== 'none',
    isStopping: stopping.isPending,
    canClear: Boolean(id && !clearing.isPending && (turns.length || current || hasHistoryFailed)),
    canSend: Boolean(
      id && stored && !options.isSendBlocked && !isGenerating && !clearing.isPending,
    ),
    canStop: Boolean(current?.runId && !stopping.isPending && !clearing.isPending),
    reload: history.reload,
    clear: () => clearing.run(undefined),
    send: generation.send,
    stop: () => (current ? stopping.run(current) : Promise.resolve()),
  };
}
