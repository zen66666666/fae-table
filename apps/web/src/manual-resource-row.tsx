// 展示一个产品型号的手册摘要和详细状态，供单据手册列表使用。
import type { ReactElement } from 'react';
import type { TicketManualResult } from '../../../packages/core/src/index.ts';
import { getTicketManualViewPath } from './api-client.ts';
import type { WorkbenchClient } from './api-client.ts';
import { Button } from './button.tsx';
import {
  getManualPreferenceKey,
  MANUAL_COPY,
  MANUAL_STATUS_LABELS,
  MANUAL_SUMMARY_LABELS,
} from './manual-copy.ts';
import { ManualLink } from './manual-link.tsx';
import { ManualMatchCard } from './manual-match-card.tsx';
import { ManualsHeading } from './manuals-heading.tsx';
import { ResourceDisclosure } from './resource-disclosure.tsx';
import { TICKET_COPY, TICKET_REASON_DETAILS } from './ticket-copy.ts';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';
import type { TicketReadFailure } from './use-ticket-read.ts';

/** 手册行可显示的状态，含尚未读到和安全的请求失败。 */
export type ManualEntryResult = TicketManualResult | TicketReadFailure | null;

/** 行内手册摘要、同源状态及用于展开和更新的回调。 */
export type ManualResourceRowProps = {
  id: string;
  model?: string;
  index: number;
  result: ManualEntryResult;
  client: WorkbenchClient;
  getStorage?: GetResourcePreferenceStorage;
  isLoading: boolean;
  refresh: () => Promise<void>;
  onDownloaded: (updated: Extract<TicketManualResult, { kind: 'found' }>) => void;
};

function getStatusMessage(result: ManualEntryResult): string {
  if (result?.kind === 'request-failed') return TICKET_REASON_DETAILS[result.reason].label;
  if (result?.kind === 'unavailable') return TICKET_COPY.autoRetryUnavailable;
  return result?.kind === 'found' ? '' : MANUAL_STATUS_LABELS[result?.kind ?? 'pending-detail'];
}

function getSummary(result: ManualEntryResult, model?: string): string {
  if (result?.kind === 'found') {
    const status = result.stored
      ? MANUAL_COPY.summaryStored
      : result.isPreparing
        ? MANUAL_SUMMARY_LABELS.loading
        : MANUAL_COPY.firstOpen;
    return [model ?? result.match.model, status].join(MANUAL_COPY.statusSeparator);
  }
  return [model, MANUAL_SUMMARY_LABELS[result?.kind ?? 'pending-detail']]
    .filter(Boolean)
    .join(MANUAL_COPY.statusSeparator);
}

/**
 * 有匹配时给出本机手册快捷入口；详细信息和失败操作留在展开区域。
 * @param props 已读的单项结果与可替换依赖。
 * @returns 可独立展开及保存展开偏好的手册行。
 * @throws 无预期错误；调用失败在展开区域显示。
 */
export function ManualResourceRow(props: ManualResourceRowProps): ReactElement {
  const { id, model, index, result, client, getStorage, isLoading, refresh, onDownloaded } = props;
  const searchUrl = result && 'searchUrl' in result ? result.searchUrl : null;
  const isFound = result?.kind === 'found';
  return (
    <ResourceDisclosure
      title={MANUAL_COPY.heading}
      summary={getSummary(result, model)}
      action={
        isFound ? (
          <ManualLink
            href={getTicketManualViewPath(id, model)}
            label={MANUAL_COPY.open}
            accessibleLabel={MANUAL_COPY.manual}
          />
        ) : undefined
      }
      preferenceKey={getManualPreferenceKey(index)}
      getStorage={getStorage}
    >
      <ManualsHeading client={client} canOpenFolder={result?.kind !== 'folder-required'} />
      {isFound ? (
        <ManualMatchCard
          key={result.match.productId}
          result={result}
          id={id}
          model={model}
          client={client}
          onDownloaded={onDownloaded}
        />
      ) : (
        <div className="manual-status">
          <p className="muted" role="status">
            {getStatusMessage(result)}
          </p>
          {searchUrl && <ManualLink href={searchUrl} label={MANUAL_COPY.search} />}
          {result?.kind === 'unavailable' && (
            <Button
              variant="quiet"
              size="small"
              disabled={isLoading}
              onClick={() => void refresh()}
            >
              {MANUAL_COPY.refresh}
            </Button>
          )}
        </div>
      )}
    </ResourceDisclosure>
  );
}
