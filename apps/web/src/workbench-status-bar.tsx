// 在首次设置与三栏工作台共用的顶部栏展示连接、导航及退出入口。
import type { ReactElement } from 'react';
import type { WorkbenchStatus } from '../../../packages/core/src/index.ts';
import { getAiConnectionState } from './ai-status.ts';
import { Button } from './button.tsx';
import { COPY, STATE_LABELS } from './copy.ts';
import type { SettingsSection } from './setup-navigation.tsx';
import type { RequestAction } from './use-request-action.ts';

/** 安全连接摘要、共享设置入口及退出操作。 */
export type WorkbenchStatusBarProps = {
  status: WorkbenchStatus | null;
  showSettings?: boolean;
  onSettings: (section: SettingsSection) => void;
  shutdown: RequestAction<void>;
};

/**
 * 展示当前 AI 模型和已选钉钉组织，并提供对应的设置入口。
 * @param props 当前连接状态、设置切换和退出操作。
 * @returns 工作台与设置页相同的顶部栏。
 * @throws 无预期错误；退出失败由页面统一展示。
 */
export function WorkbenchStatusBar({
  status,
  showSettings = true,
  onSettings,
  shutdown,
}: WorkbenchStatusBarProps): ReactElement {
  const dingtalk = status?.dingtalk;
  const organization = dingtalk?.profiles.find(
    ({ profile }) => profile === dingtalk.selectedProfile,
  )?.label;
  const connections = [
    {
      name: 'ai',
      label: COPY.aiShort,
      state: getAiConnectionState(status?.ai ?? null),
      value: status?.ai.model,
    },
    {
      name: 'dingtalk',
      label: COPY.dingtalk,
      state: dingtalk?.state ?? 'unchecked',
      value: organization,
    },
  ] as const;
  return (
    <header className="workbench-status-bar">
      <div className="workbench-brand">
        <span className="brand-mark" aria-hidden="true">
          {COPY.brandMark}
        </span>
        {COPY.brand}
      </div>
      <div className="workbench-connections">
        {connections.map(({ name, label, state, value }) => {
          const title = [label, value || STATE_LABELS[state]].join(COPY.statusSeparator);
          return (
            <Button
              key={name}
              variant="quiet"
              size="small"
              className="workbench-connection"
              data-state={state}
              title={title}
              aria-label={title + COPY.statusSeparator + STATE_LABELS[state]}
              onClick={() => onSettings(name)}
            >
              <span className="status-dot" aria-hidden="true" />
              <span className="workbench-connection-label">{title}</span>
            </Button>
          );
        })}
      </div>
      <div className="workbench-status-actions">
        {showSettings && (
          <Button size="small" onClick={() => onSettings('ai')}>
            {COPY.settings}
          </Button>
        )}
        <Button
          size="small"
          variant="quiet"
          disabled={shutdown.isPending}
          onClick={() => void shutdown.run()}
        >
          {shutdown.isPending ? COPY.shuttingDown : COPY.shutdown}
        </Button>
      </div>
    </header>
  );
}
