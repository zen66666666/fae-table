// 组合编码表快照、手动刷新和所选单据的研发人员，供右栏资料使用。
import type { ReactElement } from 'react';
import type { WorkbenchClient } from './api-client.ts';
import { Button } from './button.tsx';
import {
  CODETABLE_COPY,
  CODETABLE_REASON_LABELS,
  CODETABLE_STATE_LABELS,
  TICKET_PEOPLE_SUMMARY_LABELS,
} from './codetable-copy.ts';
import type { PollingClock } from './polling-clock.ts';
import { ResourceDisclosure } from './resource-disclosure.tsx';
import { TICKET_COPY, TICKET_REASON_DETAILS } from './ticket-copy.ts';
import { TicketPeople } from './ticket-people.tsx';
import { formatTicketTime } from './ticket-time.ts';
import { useCodeTableStatus, useTicketPeople } from './use-codetable.ts';
import type { CodeTableReadResult, TicketPeopleReadResult } from './use-codetable.ts';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';

const RESEARCHERS_PREFERENCE_KEY = 'fae-workbench:researchers-expanded';

/** 资料区的选中单据与网络、时间依赖。 */
export type CodeTablePanelProps = {
  ticketId: string | null;
  client: WorkbenchClient;
  now: number;
  clock?: PollingClock;
};

function getStatusMessage(result: CodeTableReadResult | null): string {
  if (!result) return CODETABLE_STATE_LABELS.loading;
  if ('kind' in result) {
    return result.reason === 'unknown'
      ? CODETABLE_COPY.requestFailed
      : TICKET_REASON_DETAILS[result.reason].label;
  }
  if (result.state === 'failed' && result.retryAt) return TICKET_COPY.autoRetryUnavailable;
  return CODETABLE_REASON_LABELS[result.reason] || CODETABLE_STATE_LABELS[result.state];
}

function formatPeopleOverview(people: TicketPeopleReadResult | null): string {
  if (people?.kind !== 'matched')
    return TICKET_PEOPLE_SUMMARY_LABELS[people?.kind ?? 'pending-detail'];
  const names = [
    ...new Set(people.matches.flatMap(({ people: entries }) => entries.map(({ name }) => name))),
  ];
  return names.length
    ? CODETABLE_COPY.formatPeopleSummary(names[0], names.length)
    : CODETABLE_COPY.emptySummary;
}

/**
 * 展示编码表更新时间和刷新入口，按单据标识隔离人员结果。
 * @param props 已选单据、同源接口及可替换时间依赖。
 * @returns 编码表资料状态与人员匹配区域。
 * @throws 无预期错误；错误通过安全文案展示。
 */
export function CodeTablePanel({
  ticketId,
  client,
  now,
  clock,
  getStorage,
}: CodeTablePanelProps & { getStorage?: GetResourcePreferenceStorage }): ReactElement {
  const { result, isLoading, refresh } = useCodeTableStatus({ client, clock });
  const people = useTicketPeople({ id: ticketId, client, clock });
  const status = result && 'state' in result ? result : null;
  const isRefreshing = status?.state === 'loading';
  const hasRetryNotice = status?.state === 'failed' && Boolean(status.retryAt);
  const message = getStatusMessage(result);
  const updatedAt = status?.updatedAt
    ? formatTicketTime({ time: status.updatedAt, now })
    : TICKET_COPY.notUpdated;
  return (
    <ResourceDisclosure
      title={CODETABLE_COPY.heading}
      summary={ticketId ? formatPeopleOverview(people.result) : TICKET_COPY.noSelection}
      preferenceKey={RESEARCHERS_PREFERENCE_KEY}
      getStorage={getStorage}
    >
      <div className="codetable-panel-heading">
        <p className="muted codetable-updated">
          {CODETABLE_COPY.updatedAt} {updatedAt}
        </p>
        <Button disabled={isLoading || isRefreshing} onClick={() => void refresh()}>
          {CODETABLE_COPY.refresh}
        </Button>
      </div>
      {message && (
        <p className="inline-message" role="status">
          {message}
        </p>
      )}
      {ticketId ? (
        <TicketPeople result={people.result} hasRetryNotice={hasRetryNotice} />
      ) : (
        <p className="muted">{TICKET_COPY.noSelection}</p>
      )}
    </ResourceDisclosure>
  );
}
