// 按选中的单据授权读取图片，使用页面内的账号缓存向缩略图和查看层提供地址。
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { WorkbenchClient } from './api-client.ts';
import { useTicketImageCache } from './ticket-image-cache-provider.tsx';
import type { CachedTicketImage } from './ticket-image-cache.ts';

type TicketImageStatus = { kind: 'loading' | 'failed' };

/** 图片的浏览器状态；已加载的地址可以在同一账号页面内复用。 */
export type TicketImage = TicketImageStatus | CachedTicketImage;

/** 当前单据的图片状态和共享请求入口。 */
export type TicketImages = {
  items: ReadonlyMap<string, TicketImage>;
  load: (imageId: string) => void;
  failDecode: (options: { imageId: string; url: string }) => void;
};

/**
 * 1. 从账号缓存优先取图或发起本单据的请求；2. 保存有效图片；3. 取消过期请求。
 * @param options 单据标识与提供同源图片请求的客户端。
 * @returns 缩略图与查看层共用的图片状态和操作。
 * @throws 无预期错误；请求和解码失败以状态表示。
 */
export function useTicketImages(options: {
  ticketId: string;
  client: Pick<WorkbenchClient, 'getTicketImage'>;
}): TicketImages {
  const { ticketId, client } = options;
  const cache = useTicketImageCache();
  const { items: ready, isActive: isPageActive } = useSyncExternalStore(
    cache.subscribe,
    cache.getSnapshot,
  );
  const pending = useRef(new Map<string, AbortController>());
  const failed = useRef(new Set<string>());
  const isActive = useRef(false);
  const [statuses, setStatuses] = useState(() => new Map<string, TicketImageStatus>());
  const publish = useCallback((id: string, status?: TicketImageStatus): void => {
    setStatuses((current) => {
      const next = new Map(current);
      if (status) next.set(id, status);
      else next.delete(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const requests = pending.current;
    const failures = failed.current;
    isActive.current = isPageActive;
    setStatuses(new Map());
    // 3. 切单或离开页面取消旧请求，已加载图片的生命周期由账号缓存负责。
    return () => {
      isActive.current = false;
      for (const request of requests.values()) request.abort();
      requests.clear();
      failures.clear();
    };
  }, [cache, client, isPageActive, ticketId]);

  const load = useCallback(
    (imageId: string): void => {
      // 1. 只有当前单据的图片组件可以触发请求；命中缓存时也更新使用顺序。
      if (!isPageActive || !isActive.current || cache.read(imageId) || pending.current.has(imageId))
        return;
      if (failed.current.has(imageId)) return;
      const controller = new AbortController();
      pending.current.set(imageId, controller);
      publish(imageId, { kind: 'loading' });
      void client
        .getTicketImage({ id: ticketId, imageId, signal: controller.signal })
        .then((blob) => {
          // 2. 对不支持取消的客户端也拒绝已经切单的迟到结果。
          if (controller.signal.aborted) return;
          cache.store({ id: imageId, blob });
          publish(imageId);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          failed.current.add(imageId);
          publish(imageId, { kind: 'failed' });
        })
        .finally(() => {
          if (pending.current.get(imageId) === controller) pending.current.delete(imageId);
        });
    },
    [cache, client, isPageActive, publish, ticketId],
  );
  const failDecode = useCallback(
    ({ imageId, url }: { imageId: string; url: string }): void => {
      if (!cache.remove({ id: imageId, url })) return;
      failed.current.add(imageId);
      publish(imageId, { kind: 'failed' });
    },
    [cache, publish],
  );
  const items = useMemo(
    () => new Map<string, TicketImage>([...statuses, ...ready]),
    [ready, statuses],
  );
  return { items, load, failDecode };
}
