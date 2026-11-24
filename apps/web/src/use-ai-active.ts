// 每秒读取工作台已有回答的单据标识，供左栏与模型控件共享。
import { useCallback } from 'react';
import { AI_CHAT_ACTIVE_POLL_INTERVAL_MS } from '../../../packages/core/src/index.ts';
import type { AiChatActiveStatus } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { useTicketPolling } from './use-ticket-polling.ts';
import { createTicketReadFailure, useTicketRead } from './use-ticket-read.ts';
import type { TicketReadFailure } from './use-ticket-read.ts';

/** 最新的全局回答状态及可在发送、完成或停止后立即调用的读取入口。 */
export type AiActiveState = {
  result: AiChatActiveStatus | undefined;
  reload: () => Promise<void>;
};

/**
 * 读取后台内存中的回答占用状态，不请求模型或钉钉。
 * @param options 同源客户端及可替换轮询时钟。
 * @returns 工作台可见的活动单据标识与全局模型切换门禁。
 * @throws 无预期错误；失败时沿用连接状态所报告的模型门禁。
 */
export function useAiActive(options: {
  client: WorkbenchClient;
  clock?: PollingClock;
}): AiActiveState {
  const { client, clock } = options;
  const load = useCallback(() => client.getActiveAiChats(), [client]);
  const state = useTicketRead<AiChatActiveStatus | TicketReadFailure>({
    load,
    createFailure: createTicketReadFailure,
  });
  useTicketPolling({ clock, intervalMs: AI_CHAT_ACTIVE_POLL_INTERVAL_MS, reload: state.reload });
  return {
    result: state.result && 'ticketIds' in state.result ? state.result : undefined,
    reload: state.reload,
  };
}
