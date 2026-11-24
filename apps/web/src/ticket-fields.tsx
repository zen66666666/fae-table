// 按原表单顺序展示关键字段，供详情预览使用；客户内容始终作为 React 文本节点。
import type { ReactElement } from 'react';
import { getTicketProductModel, isTicketNoteField } from '../../../packages/core/src/index.ts';
import type { TicketField } from '../../../packages/core/src/index.ts';
import { TICKET_COPY } from './ticket-copy.ts';
import { getTicketText } from './ticket-value.ts';

/** 已投影的标签、显示文本及字段类型，不包含原始复杂 JSON。 */
export type TicketFieldsProps = { fields: TicketField[] };

const MULTILINE_FIELD_TYPE = 'TextareaField';

/**
 * 展示有内容的字段名及纯文本，保留换行和后台已投影的附件名。
 * @param props 详情表单字段。
 * @returns 纯文本字段列表或缺失提示。
 * @throws 无预期错误。
 */
export function TicketFields({ fields }: TicketFieldsProps): ReactElement {
  // 仅用 trim 判断是否为空，实际渲染保留后台文本的换行和空白。
  const visible = fields.filter((field) => !isTicketNoteField(field) && field.text?.trim());
  if (!visible.length) return <p className="muted">{TICKET_COPY.noFields}</p>;
  return (
    <dl className="ticket-fields">
      {visible.map((field, index) => (
        <div
          key={index}
          data-multiline={field.type === MULTILINE_FIELD_TYPE || /[\r\n]/u.test(field.text ?? '')}
          data-product-model={getTicketProductModel([field]) !== null}
        >
          <dt>{getTicketText(field.label)}</dt>
          <dd>{field.text}</dd>
        </div>
      ))}
    </dl>
  );
}
