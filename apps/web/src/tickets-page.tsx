// 分配三栏工作台的单据选择、回复引用、资料和 AI 助手区域。
import { useId, useRef } from 'react';
import type { ReactElement } from 'react';
import { AiConversation } from './ai-conversation.tsx';
import type { PollingClock } from './polling-clock.ts';
import { ResourcePanel } from './resource-panel.tsx';
import type { SettingsSection } from './setup-navigation.tsx';
import { TicketContentColumn } from './ticket-content-column.tsx';
import type { TicketReplyHandle } from './ticket-content-column.tsx';
import { TICKET_COPY } from './ticket-copy.ts';
import { TicketListPage } from './ticket-list-page.tsx';
import { useAiActive } from './use-ai-active.ts';
import { useAiExpandedLayout } from './use-ai-expanded-layout.ts';
import { useAiModelControls } from './use-ai-model-controls.ts';
import type { ListRailState } from './use-list-rail.ts';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';
import { useTicketSelection } from './use-ticket-selection.ts';
import { useTicketSnapshot } from './use-ticket-snapshot.ts';
import { useTicketUpdate } from './use-ticket-update.ts';
import type { WorkbenchModel } from './use-workbench.ts';

/** 工作台的共享连接模型、可替换时钟和返回连接设置入口。 */
export type TicketsPageProps = {
  workbench: WorkbenchModel;
  clock?: PollingClock;
  now?: () => number;
  onSettings: (section: SettingsSection) => void;
  listRail: ListRailState;
  getResourceStorage?: GetResourcePreferenceStorage;
};

/**
 * 连接就绪后显示三栏，列表仅轮询后台快照，详情按用户选择独立读取。
 * 1. 读取快照；2. 首次选择可见的未结束条目；3. 保持标识并组合独立滚动栏。
 * @param props 同源客户端、连接状态与可替换环境依赖。
 * @returns 左侧单据列表、中间详情与回复区、右侧资料与 AI 助手。
 * @throws 无预期错误；接口错误由对应区域显示。
 */
export function TicketsPage({
  workbench,
  clock,
  now = Date.now,
  onSettings,
  listRail,
  getResourceStorage,
}: TicketsPageProps): ReactElement {
  // 1. 三栏页面只维护本机快照，不从网页直接调用钉钉或模型。
  const { result, isLoading, refresh, reload, acceptResult } = useTicketSnapshot({
    client: workbench.client,
    clock,
  });
  // 2. 选择与排序解耦，默认只选可见且未结束的条目。
  const selection = useTicketSelection(result);
  const ticketId = selection.selected?.id ?? null;
  const detailUpdate = useTicketUpdate({
    id: ticketId,
    readAt: selection.selected?.detailReadAt,
    client: workbench.client,
    reloadList: async () => {
      try {
        // 更新已经完成后读取内存列表，避免并发的旧轮询覆盖新分组和资料版本。
        acceptResult(await workbench.client.getTickets());
      } catch {
        // 列表暂不可读时保留现有快照，后续轮询仍会更新。
      }
    },
  });
  const aiLayout = useAiExpandedLayout(getResourceStorage);
  const aiActive = useAiActive({ client: workbench.client, clock });
  const activeTicketIds = new Set(aiActive.result?.ticketIds);
  const aiModels = useAiModelControls({
    status: workbench.status?.ai ?? null,
    isAnyAnswering: aiActive.result?.isAnswering,
    client: workbench.client,
    onStatusChange: workbench.updateAiStatus,
  });
  const isListExpanded = listRail.isExpanded && !aiLayout.isExpanded;
  const listContentId = useId();
  const reply = useRef<TicketReplyHandle>(null);
  const currentTime = now();
  // 3. 详情组件按 id 隔离异步响应；普通快照轮询仅更新条目与预读版本。
  return (
    <div
      className="workbench-columns"
      data-list-expanded={isListExpanded}
      data-ai-expanded={aiLayout.isExpanded}
    >
      <TicketListPage
        snapshot={result}
        isRequesting={isLoading}
        isDingtalkReady={workbench.status?.dingtalk.state === 'ready'}
        selectedId={selection.selectedId}
        activeAiTickets={activeTicketIds}
        now={currentTime}
        getNow={now}
        clock={clock}
        isExpanded={isListExpanded}
        isToggleDisabled={aiLayout.isExpanded}
        contentId={listContentId}
        onToggle={listRail.toggle}
        onRefresh={refresh}
        onSelect={selection.select}
      />
      <TicketContentColumn
        selection={selection}
        client={workbench.client}
        now={currentTime}
        getNow={now}
        clock={clock}
        replyRef={reply}
        onWriteCompleted={reload}
        onRefreshTicket={detailUpdate.refresh}
        isRefreshingTicket={detailUpdate.isRefreshing}
        updatedDetail={detailUpdate.detail}
      />
      <aside className="workbench-right-column" aria-label={TICKET_COPY.rightColumn}>
        <ResourcePanel
          ticketId={ticketId}
          cacheRevision={selection.cacheRevision}
          isCatalogReady={workbench.status?.catalog.state === 'ready'}
          client={workbench.client}
          now={currentTime}
          getNow={now}
          clock={clock}
          getStorage={getResourceStorage}
        />
        <AiConversation
          key={ticketId}
          id={ticketId}
          client={workbench.client}
          isExpanded={aiLayout.isExpanded}
          onToggleExpanded={aiLayout.toggle}
          modelControls={aiModels}
          onModelSettings={() => onSettings('ai')}
          isKnownActive={ticketId !== null && activeTicketIds.has(ticketId)}
          onActivityChange={() => {
            void aiActive.reload();
            void workbench.reload();
          }}
          now={now}
          clock={clock}
          onInsertReply={(text) => reply.current?.fillReply(text) ?? 'unavailable'}
        />
      </aside>
    </div>
  );
}
