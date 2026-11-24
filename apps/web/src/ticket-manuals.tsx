// 按已选单据组合各型号手册行，统一读取和合并下载状态。
import { useRef } from 'react';
import type { ReactElement } from 'react';
import type { TicketManualResult } from '../../../packages/core/src/index.ts';
import { ManualResourceRow } from './manual-resource-row.tsx';
import type { ManualEntryResult } from './manual-resource-row.tsx';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';
import { useTicketManuals } from './use-ticket-manuals.ts';
import type { TicketManualsReadOptions, TicketManualsReadResult } from './use-ticket-manuals.ts';

type Found = Extract<TicketManualResult, { kind: 'found' }>;
type ManualEntry = { model?: string; result: ManualEntryResult };

function getDownloadUpdate(options: {
  current: TicketManualsReadResult | null;
  updated: Found;
  model?: string;
}): TicketManualsReadResult | undefined {
  const { current, updated, model } = options;
  // 型号或官网匹配已变化时，不能用旧下载覆盖当前的手册。
  const isSameMatch = (item: ManualEntryResult): boolean =>
    item?.kind === 'found' && item.match.productId === updated.match.productId;
  if (current?.kind === 'multiple' && model !== undefined) {
    const index = current.entries.findIndex(
      (entry) => entry.model === model && isSameMatch(entry.result),
    );
    if (index === -1) return;
    const entries = [...current.entries];
    entries[index] = { model, result: updated };
    return { ...current, entries };
  }
  if (model === undefined && current?.kind === 'found' && isSameMatch(current)) return updated;
}

/**
 * 将单据型号和手册结果按原顺序分行展示，下载完成后只更新对应的行。
 * @param props 当前单据、缓存读写依赖与可替换的偏好存储。
 * @returns 一条或多条手册摘要。
 * @throws 无预期错误；失败由手册行显示。
 */
export function TicketManuals(
  props: TicketManualsReadOptions & {
    getStorage?: GetResourcePreferenceStorage;
  },
): ReactElement {
  const { result, isLoading, refresh, acceptResult } = useTicketManuals(props);
  const latest = useRef(result);
  latest.current = result;
  const entries: ManualEntry[] = result?.kind === 'multiple' ? result.entries : [{ result }];
  return (
    <>
      {entries.map((entry, index) => (
        <ManualResourceRow
          key={entry.model ?? ''}
          {...entry}
          index={index}
          id={props.id}
          client={props.client}
          getStorage={props.getStorage}
          isLoading={isLoading}
          refresh={refresh}
          onDownloaded={(updated) => {
            const next = getDownloadUpdate({
              current: latest.current,
              updated,
              model: entry.model,
            });
            if (!next) return;
            latest.current = next;
            acceptResult(next);
          }}
        />
      ))}
    </>
  );
}
