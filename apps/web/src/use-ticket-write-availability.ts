// 按所选单据读取后端核实的操作权限，供中栏回复区使用。
import { useCallback } from 'react';
import type { TicketWriteAvailability } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { useTicketPolling } from './use-ticket-polling.ts';
import {
  createTicketReadFailure,
  useTicketRead,
  useTicketReadRevision,
} from './use-ticket-read.ts';
import type { TicketReadFailure, TicketReadState } from './use-ticket-read.ts';

const WRITE_AVAILABILITY_POLL_INTERVAL_MS = 1_500;

/** 操作权限读取需要当前单据、详情版本、客户端及可替换时钟。 */
export type TicketWriteAvailabilityOptions = {
  id: string | null;
  cacheRevision: string;
  client: WorkbenchClient;
  clock?: PollingClock;
};

/** 后端已核实的动作或安全读取失败。 */
export type TicketWriteAvailabilityResult = TicketWriteAvailability | TicketReadFailure;

/**
 * 读取本机动作快照，详情变动或后台操作完成后更新显示。
 * @param options 当前单据与可替换的读取依赖。
 * @returns 后台权限、读取状态与重载入口。
 * @throws 无预期错误；请求失败转换为安全类别。
 */
export function useTicketWriteAvailability(
  options: TicketWriteAvailabilityOptions,
): TicketReadState<TicketWriteAvailabilityResult> {
  const { id, cacheRevision, client, clock } = options;
  const load = useCallback(
    () => (id ? client.getTicketWriteAvailability(id) : Promise.resolve({ actions: [] })),
    [id, client],
  );
  const state = useTicketRead<TicketWriteAvailabilityResult>({
    load,
    createFailure: createTicketReadFailure,
  });
  useTicketReadRevision({ cacheRevision, isLoading: state.isLoading, reload: state.reload });
  const snapshot = state.result && 'actions' in state.result ? state.result : null;
  // 只在后台有待更新的状态时轮询本机快照；此接口不启动钉钉读取。
  const isWaiting = Boolean(snapshot?.isBusy || snapshot?.isDetailLoading);
  useTicketPolling({
    reload: state.reload,
    intervalMs: WRITE_AVAILABILITY_POLL_INTERVAL_MS,
    isEnabled: isWaiting,
    clock,
  });
  return state;
}
