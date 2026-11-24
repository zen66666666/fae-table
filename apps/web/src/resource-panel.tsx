// 在 AI 助手上方组合手册和研发人员的独立摘要行。
import type { ReactElement } from 'react';
import { CodeTablePanel } from './codetable-panel.tsx';
import type { CodeTablePanelProps } from './codetable-panel.tsx';
import { ManualsPanel } from './manuals-panel.tsx';
import { TICKET_COPY } from './ticket-copy.ts';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';
import './resource-panel.css';

/** 资料区的选中单据、读取依赖和本地折叠偏好入口。 */
export type ResourcePanelProps = CodeTablePanelProps & {
  cacheRevision: string;
  isCatalogReady: boolean;
  getNow?: () => number;
  getStorage?: GetResourcePreferenceStorage;
};

/**
 * 将独立可展开的手册和研发人员摘要放在右栏顶部。
 * @param props 已选单据、读取依赖和可替换的本地存储入口。
 * @returns 资料折叠区。
 * @throws 无预期错误。
 */
export function ResourcePanel({
  cacheRevision,
  isCatalogReady,
  getNow,
  getStorage,
  ...codeTable
}: ResourcePanelProps): ReactElement {
  const { ticketId, client, clock } = codeTable;
  return (
    <section className="resource-panel" aria-label={TICKET_COPY.resources}>
      <ManualsPanel
        isCatalogReady={isCatalogReady}
        ticketId={ticketId}
        cacheRevision={cacheRevision}
        client={client}
        clock={clock}
        now={getNow}
        getStorage={getStorage}
      />
      <CodeTablePanel key={ticketId ?? ''} {...codeTable} getStorage={getStorage} />
    </section>
  );
}
