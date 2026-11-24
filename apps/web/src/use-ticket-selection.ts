// 按稳定标识维护单据选择及预读版本，避免列表重排或轮询触发错误切换。
import { useEffect, useState } from 'react';
import type { TicketListItem, TicketListSnapshot } from '../../../packages/core/src/index.ts';

/** 单据选择与详情缓存版本，不包含任何后端身份信息。 */
export type TicketSelection = {
  selectedId: string | null;
  selected: TicketListItem | undefined;
  cacheRevision: string;
  select: (id: string) => void;
};

/**
 * 首次选择未结束可见条目，后续只依据用户选中的标识定位。
 * @param snapshot 后台当前列表快照。
 * @returns 当前选择、详情刷新版本及显式选择入口。
 * @throws 无；原条目不在列表时保留标识，让内容区明确提示刷新。
 */
export function useTicketSelection(snapshot: TicketListSnapshot | null): TicketSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    // 默认折叠的已结束单据不自动读取；后续重排不能改变已有选择。
    if (selectedId !== null) return;
    const first = snapshot?.items.find((ticket) => ticket.group !== 'finished');
    if (first) setSelectedId(first.id);
  }, [snapshot, selectedId]);
  const selected = snapshot?.items.find((ticket) => ticket.id === selectedId);
  // 预读完成或新一轮缓存更新才重新取详情，不跟随每次十秒快照请求。
  const cacheRevision =
    selected && selected.verification !== 'pending'
      ? `${selected.detailReadAt ?? snapshot?.updatedAt ?? ''}:${selected.verification}`
      : '';
  return { selectedId, selected, cacheRevision, select: setSelectedId };
}
