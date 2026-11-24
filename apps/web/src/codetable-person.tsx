// 渲染一个研发人员及最近归档记录，供右栏型号匹配结果列表使用。
import type { ReactElement } from 'react';
import type { CodeTablePerson } from '../../../packages/core/src/index.ts';
import { CODETABLE_COPY } from './codetable-copy.ts';
import { getTicketText } from './ticket-value.ts';

/** 编码表中聚合的单个人员及其最近一条归档信息。 */
export type CodeTablePersonCardProps = { person: CodeTablePerson };

/**
 * 以纯文本显示人员记录，不解析上游内容中的链接或标记。
 * @param props 已投影的姓名、次数和归档信息。
 * @returns 人员列表项；日期按编码表原日期显示。
 * @throws 无预期错误。
 */
export function CodeTablePersonCard({ person }: CodeTablePersonCardProps): ReactElement {
  const fields = [
    [CODETABLE_COPY.recordCount, person.recordCount],
    [CODETABLE_COPY.archivedAt, getTicketText(person.archivedAt)],
    [CODETABLE_COPY.code, getTicketText(person.code)],
    [CODETABLE_COPY.chip, getTicketText(person.chip)],
    [CODETABLE_COPY.summary, getTicketText(person.summary)],
  ] as const;
  return (
    <li className="codetable-person">
      <strong>{person.name}</strong>
      <dl>
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
