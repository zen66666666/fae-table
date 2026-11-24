// 展示官网匹配、本机 PDF 保存状态和重新下载操作，供右栏手册区使用。
import type { ReactElement } from 'react';
import type { TicketManualResult } from '../../../packages/core/src/index.ts';
import { RequestError } from './api-client.ts';
import type { WorkbenchClient } from './api-client.ts';
import { Button } from './button.tsx';
import { MANUAL_COPY, MANUAL_MATCH_LABELS } from './manual-copy.ts';
import { ManualLink } from './manual-link.tsx';
import { formatTicketDate } from './ticket-time.ts';
import { useRequestAction } from './use-request-action.ts';

type FoundManual = Extract<TicketManualResult, { kind: 'found' }>;

/** 已确定匹配的手册、对应单据及接收重新下载结果的入口。 */
export type ManualMatchCardProps = {
  result: FoundManual;
  id: string;
  model?: string;
  client: WorkbenchClient;
  onDownloaded: (result: FoundManual) => void;
};

/**
 * 显示本机手册链接和下载日期，重新下载失败时保留已有快照。
 * @param props 已匹配结果、单据、客户端与成功结果回调。
 * @returns 本机及官网入口、下载状态和操作。
 * @throws 无预期错误；重新下载失败显示固定中文反馈。
 */
export function ManualMatchCard({
  result,
  id,
  model,
  client,
  onDownloaded,
}: ManualMatchCardProps): ReactElement {
  const { match, stored } = result;
  const redownload = useRequestAction<void>({
    perform: async () => {
      const updated = await client.redownloadTicketManual(id, model);
      if (updated.kind !== 'found' || !updated.stored) throw new RequestError('unknown');
      onDownloaded(updated);
    },
  });
  return (
    <div className="manual-match">
      <div className="manual-match-heading">
        <strong>{match.model}</strong>
        <span
          className={`status-tag status-tag--${match.kind === 'exact' ? 'ready' : 'action-required'}`}
        >
          {MANUAL_MATCH_LABELS[match.kind]}
        </span>
      </div>
      <p>{match.name}</p>
      <div className="manual-links">
        <ManualLink href={match.productUrl} label={MANUAL_COPY.product} />
      </div>
      <div className="manual-storage">
        <p className="muted" role="status">
          {stored ? (
            <>
              {MANUAL_COPY.stored}{' '}
              <time dateTime={stored.downloadedAt}>{formatTicketDate(stored.downloadedAt)}</time>
            </>
          ) : (
            MANUAL_COPY.firstOpen
          )}
        </p>
        <Button
          variant="quiet"
          disabled={redownload.isPending}
          onClick={() => void redownload.run()}
        >
          {redownload.isPending ? MANUAL_COPY.redownloading : MANUAL_COPY.redownload}
        </Button>
      </div>
      {redownload.reason !== 'none' && (
        <p className="manual-action-error" role="alert">
          {MANUAL_COPY.redownloadFailed}
        </p>
      )}
    </div>
  );
}
