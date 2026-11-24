// 管理连接状态的首次加载与轮询，供准备页组合流程使用。
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AiStatus,
  CatalogStatus,
  ConnectionReason,
  WorkbenchStatus,
} from '../../../packages/core/src/index.ts';
import { getConnectionErrorReason } from './api-client.ts';
import type { WorkbenchClient } from './api-client.ts';
import { BROWSER_POLLING_CLOCK } from './polling-clock.ts';
import type { PollingClock } from './polling-clock.ts';

const POLL_INTERVAL_MS = 5_000;
type SavedConnectionPatch = Partial<Pick<WorkbenchStatus, 'ai' | 'catalog'>>;

/** 连接读取依赖和退出状态。 */
export type ConnectionStatusOptions = {
  client: WorkbenchClient;
  isStopped: boolean;
  clock?: PollingClock;
};

/** 准备页的连接快照及刷新入口；isChecking 只表示 HTTP 请求，各卡片读取自身 state。 */
export type ConnectionStatusState = {
  status: WorkbenchStatus | null;
  reason: ConnectionReason;
  isChecking: boolean;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
  updateAiStatus: (ai: AiStatus) => void;
  updateCatalogStatus: (catalog: CatalogStatus) => void;
};

/**
 * 加载并定时更新连接状态，退出后停止刷新。
 * 1. 建立可取消的组件生命周期标记；2. 区分手动复查和轻量读取；3. 注册并清理轮询。
 * @param options 客户端、停止状态及可替换计时器。
 * @returns 当前状态、失败类别和两种读取入口。
 * @throws 无；请求失败转换为允许展示的原因类别。
 */
export function useConnectionStatus(options: ConnectionStatusOptions): ConnectionStatusState {
  const { client, isStopped, clock = BROWSER_POLLING_CLOCK } = options;
  const [status, setStatus] = useState<WorkbenchStatus | null>(null);
  const [reason, setReason] = useState<ConnectionReason>('none');
  const [isChecking, setIsChecking] = useState(false);
  // 1. 已退出或卸载的页面不再触发新的后台检查。
  const isActive = useRef(true);
  const isPending = useRef(false);
  const latestUpdate = useRef<SavedConnectionPatch>({});
  isActive.current = !isStopped;
  // 2. 只有页面的显式操作触发完整复查；两种请求共用等待与快照更新。
  const readStatus = useCallback(
    async (isForced: boolean) => {
      if (!isActive.current || isPending.current) return;
      isPending.current = true;
      const previousUpdate = latestUpdate.current;
      // 仅更新请求标记，保留上次快照，避免慢速连接掩盖已经完成的其他卡片。
      setIsChecking(true);
      try {
        const result = await (isForced ? client.refreshStatus() : client.getStatus());
        if (isActive.current) {
          // 保存可能先于旧轮询响应完成，只为本次轮询内修改过的项目保留新状态。
          const recentUpdate = latestUpdate.current;
          setStatus({
            ...result,
            ai: recentUpdate.ai !== previousUpdate.ai ? (recentUpdate.ai ?? result.ai) : result.ai,
            catalog:
              recentUpdate.catalog !== previousUpdate.catalog
                ? (recentUpdate.catalog ?? result.catalog)
                : result.catalog,
          });
          setReason('none');
        }
      } catch (error) {
        if (isActive.current) setReason(getConnectionErrorReason(error));
      } finally {
        isPending.current = false;
        if (isActive.current) setIsChecking(false);
      }
    },
    [client],
  );
  const refresh = useCallback(() => readStatus(true), [readStatus]);
  const reload = useCallback(() => readStatus(false), [readStatus]);
  // 3. 定时器仅在页面运行期间存在，计时器实现可由调用方替换。
  useEffect(() => {
    if (isStopped) return;
    isActive.current = true;
    void reload();
    const timer = clock.setInterval(() => {
      void reload();
    }, POLL_INTERVAL_MS);
    return () => {
      isActive.current = false;
      clock.clearInterval(timer);
    };
  }, [clock, isStopped, reload]);
  function updateSavedStatus(patch: SavedConnectionPatch): void {
    latestUpdate.current = { ...latestUpdate.current, ...patch };
    setStatus((current) => (current ? { ...current, ...patch } : current));
  }
  return {
    status,
    reason,
    isChecking,
    refresh,
    reload,
    updateAiStatus: (ai) => updateSavedStatus({ ai }),
    updateCatalogStatus: (catalog) => updateSavedStatus({ catalog }),
  };
}
