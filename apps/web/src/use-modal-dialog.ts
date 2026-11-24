// 同步原生模态框和 React 挂载状态，由审批确认与大图查看共用。
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 挂载时打开原生模态框，卸载时关闭并交回浏览器的焦点管理。
 * @returns 绑定到当前 dialog 元素的引用。
 * @throws 无预期错误；仅对已挂载的对话框操作。
 */
export function useModalDialog(): RefObject<HTMLDialogElement | null> {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);
  return dialog;
}
