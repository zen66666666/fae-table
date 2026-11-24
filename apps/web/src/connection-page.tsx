// 组合首次设置的三个步骤和手动设置入口，由工作台根组件使用。
import type { ReactElement } from 'react';
import { AiCard } from './ai-card.tsx';
import { CatalogCard } from './catalog-card.tsx';
import { COPY } from './copy.ts';
import { DingtalkCard } from './dingtalk-card.tsx';
import { PageHeader } from './page-header.tsx';
import { ReasonNotice } from './reason-notice.tsx';
import { SetupNavigation } from './setup-navigation.tsx';
import type { SettingsSection } from './setup-navigation.tsx';
import type { WorkbenchModel } from './use-workbench.ts';
import './setup.css';

/** 连接页面的共享状态、当前区块及可用的导航动作。 */
export type ConnectionPageProps = {
  workbench: WorkbenchModel;
  section: SettingsSection;
  onContinue?: () => void;
  onPrevious?: () => void;
  onSelectSection?: (section: SettingsSection) => void;
  onOpenTickets?: () => void;
  onResumeSetup?: () => void;
};

/**
 * 在首次设置中逐项配置 AI、钉钉和资料目录，并复用卡片提供手动设置。
 * @param props 连接模型、当前区块和已允许的切换动作。
 * @returns 向导或手动设置页面。
 * @throws 无预期错误；连接失败由各卡片显示。
 */
export function ConnectionPage({
  workbench,
  section,
  onContinue,
  onPrevious,
  onSelectSection,
  onOpenTickets,
  onResumeSetup,
}: ConnectionPageProps): ReactElement {
  const isLoading = !workbench.status && workbench.reason === 'none';
  const title = onSelectSection ? COPY.settings : COPY.setup;
  const completed = {
    ai: workbench.status?.ai.isConfigured === true,
    dingtalk:
      workbench.status?.dingtalk.state === 'ready' &&
      !workbench.login.isPending &&
      !workbench.selectProfile.isPending,
    catalog: workbench.status?.catalog.state === 'ready' && !workbench.setFolder.isPending,
  };
  const navigation = { onPrevious, onOpenTickets, onResumeSetup };
  return (
    <div className="setup-page">
      <PageHeader title={title} isChecking={workbench.isChecking} onRefresh={workbench.refresh} />
      <ReasonNotice reason={workbench.reason} />
      {isLoading ? (
        <p className="muted" role="status">
          {COPY.unchecked}
        </p>
      ) : (
        <div className="setup-layout">
          <SetupNavigation section={section} completed={completed} onSelect={onSelectSection} />
          <div className="setup-content">
            {section === 'ai' && (
              <AiCard
                status={workbench.status?.ai ?? null}
                client={workbench.client}
                onContinue={onContinue}
                onStatusChange={workbench.updateAiStatus}
                navigation={navigation}
              />
            )}
            {section === 'dingtalk' && (
              <DingtalkCard
                status={workbench.status?.dingtalk ?? null}
                login={workbench.login}
                selectProfile={workbench.selectProfile}
                navigation={navigation}
                onContinue={onContinue}
              />
            )}
            {section === 'catalog' && (
              <CatalogCard
                status={workbench.status?.catalog ?? null}
                save={workbench.setFolder}
                isSetup={!onSelectSection}
                navigation={navigation}
                pickFolder={workbench.client.pickCatalogFolder}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
