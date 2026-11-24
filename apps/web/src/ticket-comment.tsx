// 展示一条评论气泡、附件名称和图片缩略图，由沟通记录列表使用。
import type { ReactElement } from 'react';
import type { TicketRecord } from '../../../packages/core/src/index.ts';
import { TICKET_COPY } from './ticket-copy.ts';
import type { TicketLocalComment } from './ticket-local-comments.ts';
import { TicketRecordImages } from './ticket-record-images.tsx';
import { TicketRecordAttachments } from './ticket-record-attachments.tsx';
import { formatTicketTime } from './ticket-time.ts';
import { getTicketText } from './ticket-value.ts';
import { TICKET_WRITE_COPY } from './ticket-write-copy.ts';
import type { TicketImages } from './use-ticket-images.ts';

/** 真实或本机纯文本评论及页面当前时间；now 单位为毫秒。 */
export type TicketCommentProps =
  | { record: TicketRecord; local?: never; now: number; images: TicketImages }
  | { record?: never; local: TicketLocalComment; now: number; images?: never };

const DELIVERY_LABELS: Record<TicketLocalComment['state'], string> = {
  sending: TICKET_WRITE_COPY.commentSending,
  sent: TICKET_WRITE_COPY.commentSent,
  failed: TICKET_WRITE_COPY.commentFailed,
  uncertain: TICKET_WRITE_COPY.commentUncertain,
};

/**
 * 将评论显示为气泡，自己的评论以右侧位置和文字标记共同区分。
 * @param props 评论文字、显示姓名、时间、可用图片以及页面当前时间。
 * @returns 纯文本评论及按需加载的缩略图。
 * @throws 无预期错误。
 */
export function TicketComment({ record, local, now, images }: TicketCommentProps): ReactElement {
  const hasImages = Boolean(record?.imageIds?.length || record?.imageCount);
  const hasAttachments = Boolean(record?.attachments.length);
  const isMine = local !== undefined || record?.isMine === true;
  const time = local?.time ?? record?.time ?? null;
  const comment = local?.text ?? record?.comment ?? null;
  const name = isMine ? TICKET_COPY.mine : getTicketText(record?.actor ?? null);
  return (
    <li
      className={`ticket-comment${isMine ? ' ticket-comment--mine' : ''}`}
      data-local-comment={local?.key}
    >
      <div className="ticket-comment-heading">
        <span className="ticket-comment-avatar" aria-hidden="true">
          {Array.from(name)[0]}
        </span>
        <strong>{name}</strong>
        <time dateTime={time ?? undefined}>
          {local?.state === 'sending'
            ? TICKET_WRITE_COPY.commentJustNow
            : formatTicketTime({ time, now })}
        </time>
      </div>
      <div className="ticket-comment-bubble">
        {(comment || (!hasAttachments && !hasImages)) && <p>{getTicketText(comment)}</p>}
        {record && <TicketRecordAttachments names={record.attachments} />}
        {record && images && hasImages && (
          <TicketRecordImages
            key={JSON.stringify(record.imageIds)}
            imageIds={record.imageIds}
            imageCount={record.imageCount}
            images={images}
          />
        )}
      </div>
      {local && (
        <p className="ticket-comment-delivery" role="status">
          {DELIVERY_LABELS[local.state]}
          {local.message && `${TICKET_COPY.countSeparator}${local.message}`}
        </p>
      )}
    </li>
  );
}
