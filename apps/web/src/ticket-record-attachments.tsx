// 将沟通记录的附件名称渲染成文件标签，由评论和系统动作共用。
import type { ReactElement } from 'react';
import { TICKET_RECORD_COPY } from './ticket-record-copy.ts';

/** 后台已经投影的附件文件名，不含路径或下载地址。 */
export type TicketRecordAttachmentsProps = { names: readonly string[] };

/**
 * 在沟通记录中展示纯文本文件名，较长的文件名可以换行。
 * @param props 这条记录的附件文件名。
 * @returns 有附件时返回文件标签，无内容时返回 null。
 * @throws 无预期错误。
 */
export function TicketRecordAttachments({
  names,
}: TicketRecordAttachmentsProps): ReactElement | null {
  if (!names.length) return null;
  return (
    <ul className="ticket-record-attachments" aria-label={TICKET_RECORD_COPY.attachmentsLabel}>
      {names.map((name, index) => (
        <li key={index}>
          <span className="ticket-file-icon" aria-hidden="true" />
          {name}
        </li>
      ))}
    </ul>
  );
}
