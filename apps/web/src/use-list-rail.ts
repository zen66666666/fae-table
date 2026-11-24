// 管理左侧单据栏的宽屏默认和窄屏切换，供三栏工作台调用。
import { useEffect, useMemo, useState } from 'react';

const NARROW_VIEWPORT_QUERY = '(width < 1280px)';

/** 可替换的窗口宽度查询，测试可替换浏览器 matchMedia。 */
export type MatchWorkbenchViewport = (query: string) => MediaQueryList | null;

/** 左栏展开状态和手动切换入口。 */
export type ListRailState = { isExpanded: boolean; toggle: () => void };

function matchBrowserViewport(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null;
}

/**
 * 窄窗口把左栏收成窄边栏，用户可以在当前宽度下手动展开或收起。
 * 1. 跟踪窗口当前宽度；2. 在本次打开期间优先采用用户选择。
 * @param matchViewport 可替换的浏览器宽度查询。
 * @returns 当前展开状态和不持久化的切换操作。
 * @throws 无预期错误。
 */
export function useListRail(
  matchViewport: MatchWorkbenchViewport = matchBrowserViewport,
): ListRailState {
  // 1. 首次渲染使用窗口当前宽度，避免窄窗口先显示完整左栏。
  const viewport = useMemo(() => matchViewport(NARROW_VIEWPORT_QUERY), [matchViewport]);
  const [isNarrow, setIsNarrow] = useState(() => viewport?.matches === true);
  const [manualExpanded, setManualExpanded] = useState<boolean>();
  useEffect(() => {
    if (!viewport) return;
    const onViewportChange = ({ matches }: Pick<MediaQueryListEvent, 'matches'>): void => {
      setIsNarrow(matches);
    };
    onViewportChange(viewport);
    viewport.addEventListener('change', onViewportChange);
    return () => viewport.removeEventListener('change', onViewportChange);
  }, [viewport]);
  // 2. AI 放大只覆盖页面布局，窗口变化和进出设置不会清掉用户的选择。
  const isExpanded = manualExpanded ?? !isNarrow;
  return { isExpanded, toggle: () => setManualExpanded((value) => !(value ?? !isNarrow)) };
}
