// 定时读取后台已经生成的单据快照，供三栏页面更新分组和预读进度。
import { useCallback } from 'react';
import { createTicketListSnapshotFailure } from '../../../packages/core/src/index.ts';
import type { TicketListSnapshot } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { TICKET_POLL_INTERVAL_MS } from './ticket-constants.ts';
import { useTicketPolling } from './use-ticket-polling.ts';
import { useTicketRead } from './use-ticket-read.ts';
import type { TicketReadState } from './use-ticket-read.ts';

/** 列表快照依赖；客户端与轮询计时器均可由宿主替换。 */
export type TicketSnapshotOptions = { client: WorkbenchClient; clock?: PollingClock };

/**
 * 首次及每十秒读取内存快照，手动刷新只提交后台刷新请求。
 * 1. 共用请求生命周期；2. 在页面存在时持续读取本机快照。
 * @param options 固定接口客户端和可替换轮询时钟。
 * @returns 快照、HTTP 请求状态和手动刷新入口。
 * @throws 无；失败沿用共享的失败结果，不会伪装成空列表。
 */
export function useTicketSnapshot(
  options: TicketSnapshotOptions,
): TicketReadState<TicketListSnapshot> {
  const { client, clock } = options;
  // 1. GET 仅取后台结果，POST 仅请求提前刷新，二者都不等待 CLI。
  const load = useCallback(
    (isRefresh: boolean) => (isRefresh ? client.refreshTickets() : client.getTickets()),
    [client],
  );
  const state = useTicketRead({ load, createFailure: createTicketListSnapshotFailure });
  // 2. 预读结果由后台写回内存，网页不逐项发起详情读取来补齐列表。
  useTicketPolling({ clock, intervalMs: TICKET_POLL_INTERVAL_MS, reload: state.reload });
  return state;
}
