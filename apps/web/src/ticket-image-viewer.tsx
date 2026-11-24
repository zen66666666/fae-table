// 提供沟通记录图片的模态查看、切换和关闭，只使用本页生成的 Blob 地址。
import type { ReactElement } from 'react';
import { TICKET_RECORD_COPY } from './ticket-record-copy.ts';
import { useModalDialog } from './use-modal-dialog.ts';
import type { TicketImage } from './use-ticket-images.ts';

/** 当前图片、在本条记录中的序号及查看层操作。 */
export type TicketImageViewerProps = {
  image: TicketImage | undefined;
  position: number;
  total: number;
  onNavigate: (direction: -1 | 1) => void;
  onClose: () => void;
  onImageError: (url: string) => void;
};

/**
 * 打开支持键盘和遮罩关闭的原生查看层，并保持同条沟通记录内的图片顺序。
 * @param props 当前图片及切换或关闭动作。
 * @returns 限制在视口内的查看层。
 * @throws 无预期错误；图片显示失败交给共享状态处理。
 */
export function TicketImageViewer({
  image,
  position,
  total,
  onNavigate,
  onClose,
  onImageError,
}: TicketImageViewerProps): ReactElement {
  const dialog = useModalDialog();
  const hasPrevious = position > 0;
  const hasNext = position + 1 < total;
  return (
    <dialog
      ref={dialog}
      aria-label={TICKET_RECORD_COPY.imageViewer}
      className="ticket-image-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && hasPrevious) {
          event.preventDefault();
          onNavigate(-1);
        }
        if (event.key === 'ArrowRight' && hasNext) {
          event.preventDefault();
          onNavigate(1);
        }
      }}
    >
      <div className="ticket-image-viewer">
        {image?.kind === 'ready' ? (
          <img
            alt={`${TICKET_RECORD_COPY.imageViewer} ${position + 1}`}
            src={image.url}
            onError={() => onImageError(image.url)}
          />
        ) : (
          <p className="ticket-image-viewer-message" role="status">
            {image?.kind === 'failed'
              ? TICKET_RECORD_COPY.imageFailed
              : TICKET_RECORD_COPY.imageLoading}
          </p>
        )}
      </div>
      <button
        className="ticket-image-control ticket-image-control--close"
        type="button"
        aria-label={TICKET_RECORD_COPY.closeImage}
        onClick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
      {total > 1 && (
        <>
          <button
            className="ticket-image-control ticket-image-control--previous"
            type="button"
            aria-label={TICKET_RECORD_COPY.previousImage}
            disabled={!hasPrevious}
            onClick={() => onNavigate(-1)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            className="ticket-image-control ticket-image-control--next"
            type="button"
            aria-label={TICKET_RECORD_COPY.nextImage}
            disabled={!hasNext}
            onClick={() => onNavigate(1)}
          >
            <span aria-hidden="true">›</span>
          </button>
        </>
      )}
      <span className="ticket-image-position" aria-live="polite">
        {position + 1} / {total}
      </span>
    </dialog>
  );
}
