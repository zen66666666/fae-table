// 提供单张更新的小按钮，由标题、不可用卡片和审批确认共用。
import type { ReactElement } from 'react';
import { Button } from './button.tsx';
import { TICKET_WRITE_COPY } from './ticket-write-copy.ts';

/** 更新进度、可选禁用原因和调用方提供的单张更新操作。 */
export type TicketUpdateButtonProps = {
  isRefreshing: boolean;
  isDisabled?: boolean;
  variant?: 'secondary' | 'quiet';
  onUpdate: () => void | Promise<void>;
};

/**
 * 根据当前更新状态提供一致的按钮文字，避免重复请求。
 * @param props 更新状态、样式和当前单据的可替换回调。
 * @returns 小号更新按钮。
 * @throws 无预期错误；更新失败由调用方反馈。
 */
export function TicketUpdateButton({
  isRefreshing,
  isDisabled,
  variant = 'secondary',
  onUpdate,
}: TicketUpdateButtonProps): ReactElement {
  return (
    <Button
      size="small"
      variant={variant}
      disabled={isDisabled || isRefreshing}
      onClick={() => void onUpdate()}
    >
      {isRefreshing ? TICKET_WRITE_COPY.refreshingTicket : TICKET_WRITE_COPY.refreshTicket}
    </Button>
  );
}
