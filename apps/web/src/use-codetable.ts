// 读取右栏的编码表状态和单据人员结果，状态与详情均走独立的本机快照接口。
import { useCallback } from 'react';
import type { CodeTableStatus, TicketPeopleResult } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { useTicketPolling } from './use-ticket-polling.ts';
import { createTicketReadFailure, useTicketRead } from './use-ticket-read.ts';
import type { TicketReadFailure, TicketReadState } from './use-ticket-read.ts';

const CODETABLE_POLL_INTERVAL_MS = 5_000;

type ReadOptions = { client: WorkbenchClient; clock?: PollingClock };
/** 编码表状态接口响应或仅含安全类别的 HTTP 失败。 */
export type CodeTableReadResult = CodeTableStatus | TicketReadFailure;

/** 已选单据的人员响应或仅含安全类别的 HTTP 失败。 */
export type TicketPeopleReadResult = TicketPeopleResult | TicketReadFailure;

/** 读取单据匹配结果所需的已选标识和可替换网络、轮询依赖。 */
export type TicketPeopleReadOptions = ReadOptions & { id: string | null };

function useCodeTableRead<Result>(options: {
  load: (isRefresh: boolean) => Promise<Result>;
  clock?: PollingClock;
  isEnabled?: boolean;
}): TicketReadState<Result | TicketReadFailure> {
  const state = useTicketRead<Result | TicketReadFailure>({
    load: options.load,
    createFailure: createTicketReadFailure,
  });
  // 自动轮询只读取本机缓存；刷新编码表仅由显式按钮请求。
  useTicketPolling({
    clock: options.clock,
    intervalMs: CODETABLE_POLL_INTERVAL_MS,
    reload: state.reload,
    isEnabled: options.isEnabled,
  });
  return state;
}

/**
 * 独立读取编码表状态，并提供受保护的手动刷新入口。
 * @param options 同源客户端和可替换轮询时钟。
 * @returns 当前状态、读取标记和刷新操作。
 * @throws 无预期错误；HTTP 失败转换为安全原因。
 */
export function useCodeTableStatus(options: ReadOptions): TicketReadState<CodeTableReadResult> {
  const { client, clock } = options;
  const load = useCallback(
    (isRefresh: boolean) => (isRefresh ? client.refreshCodeTable() : client.getCodeTableStatus()),
    [client],
  );
  return useCodeTableRead({ load, clock });
}

/**
 * 跟进当前单据详情预读和编码表更新，匹配接口只读取已经缓存的详情。
 * @param options 当前单据标识、同源客户端和可替换时钟。
 * @returns 当前匹配结果及读取标记。
 * @throws 无预期错误；HTTP 失败转换为安全原因。
 */
export function useTicketPeople(
  options: TicketPeopleReadOptions,
): TicketReadState<TicketPeopleReadResult> {
  const { id, client, clock } = options;
  const load = useCallback(
    (): Promise<TicketPeopleResult> =>
      id ? client.getTicketPeople(id) : Promise.resolve({ kind: 'no-model', matches: [] }),
    [client, id],
  );
  return useCodeTableRead({ load, clock, isEnabled: id !== null });
}
