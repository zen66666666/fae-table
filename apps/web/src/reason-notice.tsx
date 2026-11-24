// 统一呈现原因类别和处理建议，避免页面展示原始程序输出。
import type { ReactElement } from 'react';
import type { ConnectionReason } from '../../../packages/core/src/index.ts';
import { REASON_DETAILS } from './copy.ts';

/** 固定原因类别及可选的当前场景处理建议。 */
export type ReasonNoticeProps = { reason: ConnectionReason; nextStep?: string };

/**
 * 将错误类别映射成固定的中文说明。
 * @param props 原因类别和可选的具体处理建议。
 * @returns 原因提示；正常状态不占用页面空间。
 * @throws 无预期错误；未知原因显示通用说明。
 */
export function ReasonNotice({ reason, nextStep }: ReasonNoticeProps): ReactElement | null {
  if (reason === 'none') return null;
  const detail = REASON_DETAILS[reason] ?? REASON_DETAILS.unknown;
  return (
    <div className="reason-notice" role="status">
      <strong>{detail.label}</strong>
      <p>{nextStep ?? detail.nextStep}</p>
    </div>
  );
}
