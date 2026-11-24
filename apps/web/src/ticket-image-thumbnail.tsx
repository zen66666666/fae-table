// 在缩略图进入中栏可视范围时发起读取，并给查看层提供键盘可达的打开入口。
import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { TICKET_RECORD_COPY } from './ticket-record-copy.ts';
import type { TicketImage } from './use-ticket-images.ts';

type ObserveThumbnail = (element: Element, onVisible: () => void) => () => void;

/** 缩略图编号、读取状态、用户动作及可替换的可见范围观察器。 */
export type TicketImageThumbnailProps = {
  imageId: string;
  position: number;
  image: TicketImage | undefined;
  onLoad: (imageId: string) => void;
  onOpen: (index: number) => void;
  onImageError: (options: { imageId: string; url: string }) => void;
  observe?: ObserveThumbnail;
};

function observeBrowserThumbnail(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') return () => undefined;
  let isObserving = true;
  const observer = new IntersectionObserver((entries) => {
    if (!isObserving || !entries.some(({ isIntersecting }) => isIntersecting)) return;
    onVisible();
  });
  function stop(): void {
    isObserving = false;
    observer.disconnect();
  }
  observer.observe(element);
  return stop;
}

/**
 * 用有界缩略图表示单张图片，进入可见范围或明确点击时读取。
 * @param props 图片在本条沟通记录中的序号、请求状态和打开动作。
 * @returns 可聚焦的缩略图按钮或图片失败提示。
 * @throws 无预期错误；图片无法解码时交给共享请求层收尾。
 */
export function TicketImageThumbnail({
  imageId,
  position,
  image,
  onLoad,
  onOpen,
  onImageError,
  observe = observeBrowserThumbnail,
}: TicketImageThumbnailProps): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  const hasFailed = image?.kind === 'failed';
  useEffect(() => {
    const element = button.current;
    // 缓存命中也记录再次进入视野，避免刚看过的缩略图被优先淘汰。
    if (element && !hasFailed) return observe(element, () => onLoad(imageId));
  }, [hasFailed, imageId, observe, onLoad]);
  if (hasFailed)
    return <span className="ticket-image-failed">{TICKET_RECORD_COPY.imageFailed}</span>;
  const label = `${TICKET_RECORD_COPY.openImage} ${position + 1}`;
  return (
    <button
      ref={button}
      className="ticket-image-thumbnail"
      type="button"
      aria-label={label}
      aria-busy={image?.kind === 'loading'}
      onClick={() => onOpen(position)}
    >
      {image?.kind === 'ready' ? (
        <img alt="" src={image.url} onError={() => onImageError({ imageId, url: image.url })} />
      ) : (
        <span>{image ? TICKET_RECORD_COPY.imageLoading : label}</span>
      )}
    </button>
  );
}
