// 管理单张单据的更新请求，供标题和写入确认框共用。
import { useRef, useState } from 'react';
import { createTicketDetailSnapshotFailure } from '../../../packages/core/src/index.ts';
import type { TicketDetailSnapshot } from '../../../packages/core/src/index.ts';
import { RequestError } from './api-client.ts';
import type { WorkbenchClient } from './api-client.ts';

type LocalUpdate = { result: TicketDetailSnapshot; previousReadAt: string | null | undefined };

/** 当前选中单据的更新结果、等待状态和手动更新入口。 */
export type TicketUpdateState = {
  detail: TicketDetailSnapshot | undefined;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
};

/**
 * 按单据合并并发更新，切换单据后只显示该单自己的更新结果。
 * @param options 当前选中单、列表已知的读取时间、客户端和本机快照重载回调。
 * @returns 选中单据的最新手动更新及操作状态。
 * @throws 无；网络错误转换为现有单据读取失败状态。
 */
export function useTicketUpdate(options: {
  id: string | null;
  readAt: string | null | undefined;
  client: WorkbenchClient;
  reloadList: () => Promise<void>;
}): TicketUpdateState {
  const { id, readAt, client, reloadList } = options;
  const pending = useRef(new Map<string, Promise<void>>());
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const [details, setDetails] = useState(() => new Map<string, LocalUpdate>());
  const current = id ? details.get(id) : undefined;

  async function update(id: string): Promise<void> {
    let result: TicketDetailSnapshot;
    try {
      result = await client.refreshTicket(id);
    } catch (error) {
      result = createTicketDetailSnapshotFailure(
        error instanceof RequestError ? error.reason : 'unknown',
      );
    }
    setDetails((previous) => new Map(previous).set(id, { result, previousReadAt: readAt }));
    await reloadList();
  }

  function refresh(): Promise<void> {
    // 两个入口共用同一次更新；确认框只有等到本次更新完成后才重新准备。
    if (!id) return Promise.resolve();
    const existing = pending.current.get(id);
    if (existing) return existing;
    const running = update(id).finally(() => {
      pending.current.delete(id);
      setRefreshing(new Set(pending.current.keys()));
    });
    pending.current.set(id, running);
    setRefreshing(new Set(pending.current.keys()));
    return running;
  }

  // 定期预读可能比上一次手动更新还新，切回时优先显示较新的结果。
  const lastUpdate = current?.result.readAt ?? current?.previousReadAt;
  const hasNewerRead = Boolean(readAt && (!lastUpdate || readAt > lastUpdate));
  return {
    detail: hasNewerRead ? undefined : current?.result,
    isRefreshing: id !== null && refreshing.has(id),
    refresh,
  };
}
