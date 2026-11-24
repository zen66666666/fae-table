// 显示首次设置的步骤或手动设置的选项，供连接页面使用。
import type { ReactElement } from 'react';
import { AI_COPY } from './ai-copy.ts';
import { Button } from './button.tsx';
import { COPY } from './copy.ts';

/** 首次向导和手动设置共用的三个设置区块。 */
export type SettingsSection = 'ai' | 'dingtalk' | 'catalog';

/** 当前设置区块和手动切换回调；向导步骤由测试与授权控制。 */
export type SetupNavigationProps = {
  section: SettingsSection;
  completed: Readonly<Record<SettingsSection, boolean>>;
  onSelect?: (section: SettingsSection) => void;
};

const SETTINGS_SECTIONS = ['ai', 'dingtalk', 'catalog'] as const;
const SECTION_LABELS = { ai: AI_COPY.title, dingtalk: COPY.dingtalkStep, catalog: COPY.catalog };

/**
 * 显示向导当前步骤，或提供手动设置的区块切换。
 * @param props 当前设置区块和可选切换回调。
 * @returns 有序的设置导航。
 * @throws 无预期错误。
 */
export function SetupNavigation({
  section,
  completed,
  onSelect,
}: SetupNavigationProps): ReactElement {
  return (
    <nav className="setup-navigation" aria-label={onSelect ? COPY.settings : COPY.setupSteps}>
      <ol>
        {SETTINGS_SECTIONS.map((name, index) => {
          const isComplete = name !== section && completed[name];
          return (
            <li key={name} aria-current={!onSelect && name === section ? 'step' : undefined}>
              {onSelect ? (
                <Button
                  variant="quiet"
                  aria-current={name === section ? 'true' : undefined}
                  onClick={() => onSelect(name)}
                >
                  {SECTION_LABELS[name]}
                </Button>
              ) : (
                <span className="setup-step" data-complete={isComplete}>
                  <span
                    className="setup-step-number"
                    aria-label={isComplete ? COPY.setupCompleted : undefined}
                  >
                    {isComplete ? '✓' : index + 1}
                  </span>
                  {SECTION_LABELS[name]}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
