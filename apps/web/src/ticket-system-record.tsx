// 将非评论记录显示为紧凑的灰色系统行，由沟通记录列表使用。
import type { ReactElement } from 'react';
import type { TicketRecord } from '../../../packages/core/src/index.ts';
import { TicketRecordImages } from './ticket-record-images.tsx';
import { TicketRecordAttachments } from './ticket-record-attachments.tsx';
import { formatTicketSystemRecord } from './ticket-record-text.ts';
import { formatTicketTime } from './ticket-time.ts';
import type { TicketImages } from './use-ticket-images.ts';

/** 已投影的系统动作及页面当前时间；now 单位为毫秒，动作允许保留附带的意见。 */
export type TicketSystemRecordProps = { record: TicketRecord; now: number; images: TicketImages };

/**
 * 展示时间及单行系统动作说明，名称和意见均作为纯文本渲染。
 * @param props 系统记录及可替换的当前时间；已知动作中文化，未知动作保留代码。
 * @returns 灰色系统列表项；窄窗口按文本自然换行。
 * @throws 无预期错误。
 */
export function TicketSystemRecord({ record, now, images }: TicketSystemRecordProps): ReactElement {
  return (
    <li className="ticket-system-record">
      <time dateTime={record.time ?? undefined}>
        {formatTicketTime({ time: record.time, now })}
      </time>
      <span>{formatTicketSystemRecord(record)}</span>
      <TicketRecordAttachments names={record.attachments} />
      <TicketRecordImages
        key={JSON.stringify(record.imageIds)}
        imageIds={record.imageIds}
        imageCount={record.imageCount}
        images={images}
      />
    </li>
  );
}
