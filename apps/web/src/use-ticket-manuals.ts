// 获取已选单据的手册快照，并在后台给出的退避时间后重试。
import { useCallback, useEffect } from 'react';
import type { TicketManualsResult } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { PollingClock } from './polling-clock.ts';
import { useTicketPolling } from './use-ticket-polling.ts';
import {
  createTicketReadFailure,
  useTicketRead,
  useTicketReadRevision,
} from './use-ticket-read.ts';
import type { TicketReadFailure, TicketReadState } from './use-ticket-read.ts';

const MANUALS_POLL_INTERVAL_MS = 1_500;

/** 可替换的窗口焦点监听；返回用于注销监听的函数。 */
export type SubscribeManualsFocus = (reload: () => void) => () => void;

/** 当前单据、已完成详情版本和可替换的本机接口与轮询时钟。 */
export type TicketManualsReadOptions = {
  id: string;
  cacheRevision: string;
  client: WorkbenchClient;
  clock?: PollingClock;
  now?: () => number;
  subscribeFocus?: SubscribeManualsFocus;
};

/** 手册业务结果或非业务的安全请求失败。 */
export type TicketManualsReadResult = TicketManualsResult | TicketReadFailure;

function subscribeBrowserFocus(reload: () => void): () => void {
  window.addEventListener('focus', reload);
  return () => window.removeEventListener('focus', reload);
}

/**
 * 读取手册结果并跟进后台官网查询，离开当前单据后由组件键撤销旧响应。
 * 1. 读取当前结果；2. 预读版本变化时重新读取；3. 轮询后台下载；4. 返回窗口时读取本机状态。
 * @param options 选中单据、详情版本和可替换依赖。
 * @returns 当前结果、读取状态与共用请求入口。
 * @throws 无预期错误；请求错误转换为安全失败。
 */
export function useTicketManuals(
  options: TicketManualsReadOptions,
): TicketReadState<TicketManualsReadResult> {
  const { id, cacheRevision, client, clock, now, subscribeFocus = subscribeBrowserFocus } = options;
  // 1. 浏览器只请求本机接口，官网请求由后台校验和缓存。
  const load = useCallback(
    (isRefresh: boolean) =>
      isRefresh ? client.refreshTicketManuals(id) : client.getTicketManuals(id),
    [id, client],
  );
  const state = useTicketRead<TicketManualsReadResult>({
    load,
    createFailure: createTicketReadFailure,
  });
  // 2. 同一单据的型号可能随新详情改变，版本完成后才读取依赖结果。
  useTicketReadRevision({ cacheRevision, isLoading: state.isLoading, reload: state.reload });
  // 3. 等待首次查询、后台保存和退避恢复，已保存的手册停止连续轮询。
  const result = state.result;
  const entries =
    result?.kind === 'multiple' ? result.entries.map((entry) => entry.result) : [result];
  const isWaiting = entries.some(
    (entry) => entry?.kind === 'pending-detail' || entry?.kind === 'loading',
  );
  const isPreparing = entries.some(
    (entry) => entry?.kind === 'found' && !entry.stored && entry.isPreparing === true,
  );
  const isFound = entries.some((entry) => entry?.kind === 'found');
  const retries = entries.flatMap((entry) =>
    entry?.kind === 'unavailable' && entry.retryAt !== undefined ? [entry.retryAt] : [],
  );
  // 等待中的型号仍须按短间隔轮询，不能被另一型号的退避截止时间阻塞。
  const retryAt = retries.length && !isWaiting && !isPreparing ? Math.min(...retries) : undefined;
  useTicketPolling({
    clock,
    now,
    intervalMs: MANUALS_POLL_INTERVAL_MS,
    reload: state.reload,
    notBefore: retryAt,
    isEnabled: isWaiting || isPreparing || retryAt !== undefined,
  });
  // 4. PDF 在新标签页下载，用户切回工作台后才能安全确认保存状态。
  const { reload } = state;
  useEffect(() => {
    if (!isFound) return;
    return subscribeFocus(() => void reload());
  }, [isFound, reload, subscribeFocus]);
  return state;
}
