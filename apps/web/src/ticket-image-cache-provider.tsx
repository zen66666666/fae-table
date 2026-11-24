// 将图片缓存绑定到当前钉钉账号和页面，供沟通记录按需取图。
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createTicketImageCache } from './ticket-image-cache.ts';
import type { TicketImageCache } from './ticket-image-cache.ts';

const CACHE_CONTEXT = createContext<TicketImageCache | null>(null);

type ObservePageVisibility = (options: { onLeave: () => void; onReturn: () => void }) => () => void;

/** 当前账号的页面内容及可替换的图片缓存和页面生命周期。 */
export type TicketImageCacheProviderProps = {
  children: ReactNode;
  createCache?: () => TicketImageCache;
  observePage?: ObservePageVisibility;
};

function observeBrowserPage({
  onLeave,
  onReturn,
}: Parameters<ObservePageVisibility>[0]): () => void {
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('pageshow', onReturn);
  return () => {
    window.removeEventListener('pagehide', onLeave);
    window.removeEventListener('pageshow', onReturn);
  };
}

/**
 * 向当前页面提供一个账号范围内的缓存，离开页面或更换账号时释放地址。
 * @param props 页面内容及可替换的浏览器操作。
 * @returns 包含图片缓存的页面内容。
 * @throws 无预期错误。
 */
export function TicketImageCacheProvider({
  children,
  createCache = createTicketImageCache,
  observePage = observeBrowserPage,
}: TicketImageCacheProviderProps): ReactElement {
  const [cache] = useState(createCache);
  useEffect(() => {
    cache.setActive(true);
    const stopObserving = observePage({
      onLeave: () => cache.setActive(false),
      onReturn: () => cache.setActive(true),
    });
    return () => {
      stopObserving();
      cache.setActive(false);
    };
  }, [cache, observePage]);
  return <CACHE_CONTEXT.Provider value={cache}>{children}</CACHE_CONTEXT.Provider>;
}

/**
 * 取得当前账号的图片缓存。
 * @returns 与同一页面内其他记录共用的缓存。
 * @throws 组件未放在账号范围内时抛出 Error。
 */
export function useTicketImageCache(): TicketImageCache {
  const cache = useContext(CACHE_CONTEXT);
  if (!cache) throw new Error('缺少工作台图片缓存');
  return cache;
}
