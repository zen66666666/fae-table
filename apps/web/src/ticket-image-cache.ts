// 管理工作台页面已加载的图片地址，供缓存组件持有和释放。

/** 单个账号页面最多保留的已加载图片数。 */
export const TICKET_IMAGE_CACHE_LIMIT = 300;

/** 可供缩略图和查看层共用的本机 Blob 地址。 */
export type CachedTicketImage = { kind: 'ready'; url: string };

/** 可替换的浏览器 Blob 地址生成和释放操作。 */
export type TicketImageUrls = {
  create: (blob: Blob) => string;
  revoke: (url: string) => void;
};

const BROWSER_BLOB_URLS: TicketImageUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

type TicketImageCacheSnapshot = {
  items: ReadonlyMap<string, CachedTicketImage>;
  isActive: boolean;
};

/** 按稳定图片标识缓存的地址和供 React 订阅的快照。 */
export type TicketImageCache = {
  read: (id: string) => CachedTicketImage | undefined;
  store: (options: { id: string; blob: Blob }) => void;
  remove: (options: { id: string; url: string }) => boolean;
  setActive: (isActive: boolean) => void;
  getSnapshot: () => TicketImageCacheSnapshot;
  subscribe: (notify: () => void) => () => void;
};

/**
 * 按最近访问次序保存已加载的图片，达到上限时释放最久未用的地址。
 * 1. 注册访问与写入；2. 更新快照；3. 在关闭时释放所有地址。
 * @param options 浏览器地址操作和可替换容量。
 * @returns 可从一张单据切换至另一张时复用的内存缓存。
 * @throws 生成 Blob 地址失败时由 store 抛出，调用方负责显示失败提示。
 */
export function createTicketImageCache(
  options: {
    urls?: TicketImageUrls;
    limit?: number;
  } = {},
): TicketImageCache {
  const { urls = BROWSER_BLOB_URLS, limit = TICKET_IMAGE_CACHE_LIMIT } = options;
  const entries = new Map<string, CachedTicketImage>();
  const listeners = new Set<() => void>();
  let isActive = true;
  let snapshot: TicketImageCacheSnapshot = { items: new Map(), isActive };
  function publish(): void {
    // 2. 状态变化后发布稳定快照；仅改变使用顺序时无需重绘。
    snapshot = { items: new Map(entries), isActive };
    for (const notify of listeners) notify();
  }
  function removeEntry(id: string, entry: CachedTicketImage): void {
    entries.delete(id);
    urls.revoke(entry.url);
  }
  function read(id: string): CachedTicketImage | undefined {
    // 1. 缩略图出现在屏幕内或在查看层打开时，重新标记为最近访问。
    const item = entries.get(id);
    if (item) {
      entries.delete(id);
      entries.set(id, item);
    }
    return item;
  }
  return {
    read,
    store: ({ id, blob }) => {
      if (!isActive || read(id)) return;
      entries.set(id, { kind: 'ready', url: urls.create(blob) });
      const oldest = entries.entries().next();
      if (entries.size > limit && !oldest.done) removeEntry(...oldest.value);
      publish();
    },
    remove: ({ id, url }) => {
      const entry = entries.get(id);
      if (entry?.url !== url) return false;
      removeEntry(id, entry);
      publish();
      return true;
    },
    setActive: (next) => {
      // 3. 页面隐藏或账号作用域销毁时，旧请求不能重新写入缓存。
      if (isActive === next) return;
      isActive = next;
      if (!isActive) {
        for (const [id, entry] of entries) removeEntry(id, entry);
      }
      publish();
    },
    getSnapshot: () => snapshot,
    subscribe: (notify) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}
