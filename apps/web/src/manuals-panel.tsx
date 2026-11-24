// 组合相关手册标题、打开本机文件夹和当前单据手册，供右栏资料区使用。
import type { ReactElement } from 'react';
import type { WorkbenchClient } from './api-client.ts';
import { getManualPreferenceKey, MANUAL_COPY, MANUAL_SUMMARY_LABELS } from './manual-copy.ts';
import { ManualsHeading } from './manuals-heading.tsx';
import type { PollingClock } from './polling-clock.ts';
import { ResourceDisclosure } from './resource-disclosure.tsx';
import { TICKET_COPY } from './ticket-copy.ts';
import { TicketManuals } from './ticket-manuals.tsx';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';

/** 手册区的可见状态、选中单据及读取依赖。 */
export type ManualsPanelProps = {
  isCatalogReady: boolean;
  ticketId: string | null;
  cacheRevision: string;
  client: WorkbenchClient;
  clock?: PollingClock;
  now?: () => number;
  getStorage?: GetResourcePreferenceStorage;
};

/**
 * 在手册标题旁提供本机文件夹入口，展开后读取当前单据手册。
 * @param props 当前选择、可见状态和可替换读取依赖。
 * @returns 手册标题、文件夹按钮和当前查询结果。
 * @throws 无预期错误；操作失败显示固定中文反馈。
 */
export function ManualsPanel({
  isCatalogReady,
  ticketId,
  cacheRevision,
  client,
  clock,
  now,
  getStorage,
}: ManualsPanelProps): ReactElement {
  return (
    <section className="resource-manuals">
      {ticketId && isCatalogReady ? (
        <TicketManuals
          key={ticketId}
          id={ticketId}
          cacheRevision={cacheRevision}
          client={client}
          clock={clock}
          now={now}
          getStorage={getStorage}
        />
      ) : (
        <ResourceDisclosure
          title={MANUAL_COPY.heading}
          summary={
            isCatalogReady ? TICKET_COPY.noSelection : MANUAL_SUMMARY_LABELS['folder-required']
          }
          preferenceKey={getManualPreferenceKey(0)}
          getStorage={getStorage}
        >
          <ManualsHeading client={client} canOpenFolder={isCatalogReady} />
          {!isCatalogReady && <p className="muted">{MANUAL_COPY.folderRequired}</p>}
        </ResourceDisclosure>
      )}
    </section>
  );
}
