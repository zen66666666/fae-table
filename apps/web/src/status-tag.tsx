// 将共用连接状态显示为一致的状态标签，供三张连接卡片复用。
import type { ReactElement } from 'react';
import type { ConnectionState } from '../../../packages/core/src/index.ts';
import { STATE_LABELS } from './copy.ts';

/** 状态标签输入，状态类型直接复用 core。 */
export type StatusTagProps = { state: ConnectionState };

/**
 * 显示包含文字和状态点的连接标签。
 * @param props 当前连接状态。
 * @returns 状态标签元素，不只依赖颜色表达含义。
 * @throws 无预期错误。
 */
export function StatusTag({ state }: StatusTagProps): ReactElement {
  return (
    <span className={`status-tag status-tag--${state}`}>
      <span aria-hidden="true" className="status-dot" />
      {STATE_LABELS[state]}
    </span>
  );
}
