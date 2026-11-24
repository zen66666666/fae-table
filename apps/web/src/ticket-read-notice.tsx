// 在单据区提示需要用户处理的连接问题，可为缺失详情显示简短说明。
import type { ReactElement } from 'react';
import type { TicketReason } from '../../../packages/core/src/index.ts';
import { TICKET_REASON_DETAILS } from './ticket-copy.ts';

const CONNECTION_ACTION_REASONS = new Set<TicketReason>([
  'not-installed',
  'login-required',
  'profile-required',
  'profile-invalid',
  'session-expired',
  'connection-required',
]);

/** 单据读取的安全原因类别及可选的普通提示文字。 */
export type TicketReadNoticeProps = {
  reason: TicketReason;
  fallback?: string;
};

/**
 * 对需要用户操作的连接失败显示醒目提示，其他原因采用调用方提供的简短说明。
 * @param props 读取原因和非连接问题的备选文案。
 * @returns 连接操作提示、简短说明或空内容。
 * @throws 无预期错误。
 */
export function TicketReadNotice({ reason, fallback }: TicketReadNoticeProps): ReactElement | null {
  if (!CONNECTION_ACTION_REASONS.has(reason)) {
    return fallback ? (
      <p className="ticket-empty" role="status">
        {fallback}
      </p>
    ) : null;
  }
  const explanation = TICKET_REASON_DETAILS[reason];
  return (
    <div className="ticket-notice ticket-notice--failure" role="alert">
      <strong>{explanation.label}</strong>
      <p>{explanation.nextStep}</p>
    </div>
  );
}
