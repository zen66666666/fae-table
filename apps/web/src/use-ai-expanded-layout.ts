// 保存 AI 助手的布局偏好，并让工作台在模态窗口之外响应 Esc。
import { useEffect } from 'react';
import { useResourcePreference } from './use-resource-preference.ts';
import type {
  GetResourcePreferenceStorage,
  ResourcePreference,
} from './use-resource-preference.ts';

const AI_EXPANDED_PREFERENCE_KEY = 'fae-workbench:ai-expanded';
const ESCAPE_KEY = 'Escape';
const OPEN_DIALOG_SELECTOR = 'dialog[open]';

/**
 * 1. 恢复布局偏好。2. 在展开时另行处理未被模态窗口消耗的 Esc。
 * @param getStorage 可替换的本地界面偏好存储。
 * @returns AI 助手的展开状态与切换入口。
 * @throws 无预期错误；存储失败时偏好只在当前页面生效。
 */
export function useAiExpandedLayout(getStorage?: GetResourcePreferenceStorage): ResourcePreference {
  const preference = useResourcePreference({ key: AI_EXPANDED_PREFERENCE_KEY, getStorage }); // 1.
  const { isExpanded, setExpanded } = preference;
  useEffect(() => {
    if (!isExpanded) return;
    // 2. 捕获阶段先记住是否有模态窗口，避免窗口已在事件冒泡前关闭时同时收起 AI。
    const modalEscapes = new WeakSet<KeyboardEvent>();
    const hasOpenDialog = (): boolean => document.querySelector(OPEN_DIALOG_SELECTOR) !== null;
    const captureModalEscape = (event: KeyboardEvent): void => {
      if (event.key === ESCAPE_KEY && hasOpenDialog()) modalEscapes.add(event);
    };
    const collapseOnEscape = (event: KeyboardEvent): void => {
      if (
        event.key === ESCAPE_KEY &&
        !event.repeat &&
        !event.isComposing &&
        !event.defaultPrevented &&
        !modalEscapes.has(event) &&
        !hasOpenDialog()
      )
        setExpanded(false);
    };
    window.addEventListener('keydown', captureModalEscape, true);
    window.addEventListener('keydown', collapseOnEscape);
    return () => {
      window.removeEventListener('keydown', captureModalEscape, true);
      window.removeEventListener('keydown', collapseOnEscape);
    };
  }, [isExpanded, setExpanded]);
  return preference;
}
