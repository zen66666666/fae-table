// 保存布尔展开偏好，供右栏资料和 AI 助手共用。
import { useState } from 'react';

const IS_EXPANDED_BY_DEFAULT = false;

/** 可替换的本地偏好存储连接，只保存界面布尔值。 */
export type GetResourcePreferenceStorage = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;

/** 当前的展开状态及显式切换操作。 */
export type ResourcePreference = {
  isExpanded: boolean;
  toggle: () => void;
  setExpanded: (value: boolean) => void;
};

function getBrowserStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function readIsExpanded(key: string, getStorage: GetResourcePreferenceStorage): boolean {
  try {
    if (getStorage()?.getItem(key) === 'true') return true;
  } catch {
    // 禁用存储时首次展示默认状态，当前页仍可正常切换。
  }
  return IS_EXPANDED_BY_DEFAULT;
}

/**
 * 初始默认收起，切换时仅保存一个布尔值。
 * @param options 固定界面偏好键和可替换的本地存储入口。
 * @returns 当前展开状态和切换操作。
 * @throws 无；存储失败时只保留本页的当前值。
 */
export function useResourcePreference(options: {
  key: string;
  getStorage?: GetResourcePreferenceStorage;
}): ResourcePreference {
  const { key, getStorage = getBrowserStorage } = options;
  const [isExpanded, setIsExpanded] = useState(() => readIsExpanded(key, getStorage));
  function setExpanded(next: boolean): void {
    setIsExpanded(next);
    try {
      getStorage()?.setItem(key, String(next));
    } catch {
      // 持久化失败不能阻断本页的展开和收起。
    }
  }
  return { isExpanded, toggle: () => setExpanded(!isExpanded), setExpanded };
}
