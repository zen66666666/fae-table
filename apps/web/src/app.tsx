// 在首次设置与三栏工作台之间切换，供浏览器入口挂载。
import { useState } from 'react';
import type { ReactElement } from 'react';
import { ConnectionPage } from './connection-page.tsx';
import { ReasonNotice } from './reason-notice.tsx';
import type { SettingsSection } from './setup-navigation.tsx';
import { StoppedPage } from './stopped-page.tsx';
import { TicketImageCacheProvider } from './ticket-image-cache-provider.tsx';
import { TicketsPage } from './tickets-page.tsx';
import { useListRail } from './use-list-rail.ts';
import type { MatchWorkbenchViewport } from './use-list-rail.ts';
import { useWorkbench } from './use-workbench.ts';
import type { WorkbenchOptions } from './use-workbench.ts';
import { WorkbenchStatusBar } from './workbench-status-bar.tsx';

/** 根组件的可替换网络和轮询依赖，默认使用浏览器实现。 */
export type AppProps = WorkbenchOptions & { matchViewport?: MatchWorkbenchViewport };

type ReviewSection = 'ai' | 'dingtalk';
const PREVIOUS_SETUP_SECTION = { ai: null, dingtalk: 'ai', catalog: 'dingtalk' } as const;

function getSetupSection(options: {
  isAiConfigured: boolean;
  isDingtalkReady: boolean;
  reviewSection: ReviewSection | null;
}): SettingsSection {
  const { isAiConfigured, isDingtalkReady, reviewSection } = options;
  if (!isAiConfigured || reviewSection === 'ai') return 'ai';
  if (!isDingtalkReady || reviewSection === 'dingtalk') return 'dingtalk';
  return 'catalog';
}

/**
 * AI、钉钉和产品资料目录都就绪时进入工作台，否则显示需要处理的设置步骤。
 * @param props 可选请求客户端及轮询计时器。
 * @returns 首次设置、手动设置、三栏工作台或退出完成视图。
 * @throws 无预期错误；网络与业务失败显示为原因类别。
 */
export function App(props: AppProps): ReactElement {
  const workbench = useWorkbench(props);
  const listRail = useListRail(props.matchViewport);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const [reviewSection, setReviewSection] = useState<ReviewSection | null>(null);
  if (workbench.isStopped) return <StoppedPage />;
  const dingtalk = workbench.status?.dingtalk;
  const isAiConfigured = workbench.status?.ai.isConfigured === true;
  const isDingtalkReady =
    dingtalk?.state === 'ready' && !workbench.login.isPending && !workbench.selectProfile.isPending;
  const canUseWorkbench =
    isAiConfigured &&
    isDingtalkReady &&
    workbench.status?.catalog.state === 'ready' &&
    !workbench.setFolder.isPending &&
    workbench.reason !== 'session-expired';
  const canShowWorkbench = canUseWorkbench && !settingsSection && !reviewSection;
  const setupSection = getSetupSection({ isAiConfigured, isDingtalkReady, reviewSection });
  const previousSection = PREVIOUS_SETUP_SECTION[setupSection];
  // 同账号进入设置页时共享已加载图片，账号切换或会话失效时立即换掉缓存。
  const imageAccount =
    dingtalk?.isLoggedIn && workbench.reason !== 'session-expired'
      ? dingtalk.selectedProfile
      : null;
  return (
    <TicketImageCacheProvider key={imageAccount ?? ''}>
      <div className={canShowWorkbench ? 'workbench-frame' : 'settings-frame'}>
        <WorkbenchStatusBar
          status={workbench.status}
          showSettings={canShowWorkbench || settingsSection !== null}
          shutdown={workbench.shutdown}
          onSettings={setSettingsSection}
        />
        <ReasonNotice reason={workbench.shutdown.reason} />
        <main className={canShowWorkbench ? 'workbench-main' : 'workbench-shell'}>
          {!canShowWorkbench ? (
            <ConnectionPage
              workbench={workbench}
              section={settingsSection ?? setupSection}
              onSelectSection={settingsSection ? setSettingsSection : undefined}
              onContinue={settingsSection ? undefined : () => setReviewSection(null)}
              onPrevious={
                settingsSection || !previousSection
                  ? undefined
                  : () => setReviewSection(previousSection)
              }
              onOpenTickets={
                settingsSection && canUseWorkbench ? () => setSettingsSection(null) : undefined
              }
              onResumeSetup={
                settingsSection && !canUseWorkbench ? () => setSettingsSection(null) : undefined
              }
            />
          ) : (
            <TicketsPage
              key={dingtalk?.selectedProfile ?? ''}
              workbench={workbench}
              clock={props.clock}
              now={props.now}
              listRail={listRail}
              onSettings={setSettingsSection}
            />
          )}
        </main>
      </div>
    </TicketImageCacheProvider>
  );
}
