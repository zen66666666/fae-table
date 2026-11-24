// 将同一条沟通记录的缩略图和查看层组合起来，由评论和系统行共用。
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { TicketImageThumbnail } from './ticket-image-thumbnail.tsx';
import { TicketImageViewer } from './ticket-image-viewer.tsx';
import { TICKET_RECORD_COPY } from './ticket-record-copy.ts';
import type { TicketImages } from './use-ticket-images.ts';

/** 后台投影的安全图片标识、原记录图片数以及同单据图片读取器。 */
export type TicketRecordImagesProps = {
  imageIds?: readonly string[];
  imageCount: number;
  images: TicketImages;
};

const NO_IMAGE_IDS: readonly string[] = [];

/**
 * 以原记录顺序显示可用缩略图，打开后只在这条记录的图片间切换。
 * @param props 同一条记录的图片标识、数量及图片请求状态。
 * @returns 图片列表和可选查看层，无图片时为空。
 * @throws 无预期错误；缺少可用标识的图片显示固定失败提示。
 */
export function TicketRecordImages({
  imageIds = NO_IMAGE_IDS,
  imageCount,
  images,
}: TicketRecordImagesProps): ReactElement | null {
  const [position, setPosition] = useState<number | null>(null);
  const { items, load } = images;
  const imageId = position === null ? null : imageIds[position];
  const viewing = imageId ? items.get(imageId) : undefined;
  useEffect(() => {
    // 若正在查看的图恰好被淘汰，回到当前单据的授权入口补读它。
    if (imageId && !viewing) load(imageId);
  }, [imageId, viewing, load]);
  if (!imageIds.length && !imageCount) return null;
  function openImage(index: number): void {
    const id = imageIds[index];
    if (!id) return;
    load(id);
    setPosition(index);
  }
  return (
    <div className="ticket-record-images">
      {imageIds.map((id, index) => (
        <TicketImageThumbnail
          key={`${id}:${index}`}
          imageId={id}
          position={index}
          image={items.get(id)}
          onLoad={load}
          onOpen={openImage}
          onImageError={images.failDecode}
        />
      ))}
      {imageCount > imageIds.length && (
        <span className="ticket-image-failed">{TICKET_RECORD_COPY.imageFailed}</span>
      )}
      {position !== null && imageId && (
        <TicketImageViewer
          image={viewing}
          position={position}
          total={imageIds.length}
          onNavigate={(direction) => openImage(position + direction)}
          onClose={() => setPosition(null)}
          onImageError={(url) => images.failDecode({ imageId, url })}
        />
      )}
    </div>
  );
}
