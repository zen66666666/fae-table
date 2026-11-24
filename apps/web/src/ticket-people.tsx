// 渲染当前选中单据的编码表匹配结果，供右栏研发人员区使用。
import type { ReactElement } from 'react';
import { TICKET_PEOPLE_LABELS } from './codetable-copy.ts';
import { CodeTableMatchCard } from './codetable-match.tsx';
import { TICKET_REASON_DETAILS } from './ticket-copy.ts';
import type { TicketPeopleReadResult } from './use-codetable.ts';

/** 当前单据的人员快照及上层重试提示是否已显示。 */
export type TicketPeopleProps = {
  result: TicketPeopleReadResult | null;
  hasRetryNotice?: boolean;
};

/**
 * 显示匹配型号、研发人员或未查到人员的具体原因。
 * @param props 已选单据的人员快照和重试提示状态。
 * @returns 人员匹配列表或安全状态提示；上层已有重试提示时可省略重复状态。
 * @throws 无预期错误；接口失败只显示固定原因。
 */
export function TicketPeople({ result, hasRetryNotice }: TicketPeopleProps): ReactElement | null {
  if (result?.kind === 'unavailable' && hasRetryNotice) return null;
  if (result?.kind === 'matched') {
    return (
      <div className="codetable-matches">
        {result.matches.map((match) => (
          <CodeTableMatchCard key={`${match.kind}:${match.model}`} match={match} />
        ))}
      </div>
    );
  }
  const message =
    result?.kind === 'request-failed'
      ? TICKET_REASON_DETAILS[result.reason].label
      : TICKET_PEOPLE_LABELS[result?.kind ?? 'pending-detail'];
  return (
    <p className="muted" role="status">
      {message}
    </p>
  );
}
