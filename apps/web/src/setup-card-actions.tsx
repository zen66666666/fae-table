// 统一设置卡片底部的上一步、返回和当前步骤操作位置。
import type { ReactElement, ReactNode } from 'react';
import { Button } from './button.tsx';
import { COPY } from './copy.ts';
import { TICKET_COPY } from './ticket-copy.ts';

/** 当前设置页的导航回调与卡片主要操作。 */
export type SetupCardActionsProps = {
  onPrevious?: () => void;
  onOpenTickets?: () => void;
  onResumeSetup?: () => void;
  children?: ReactNode;
};

/**
 * 把上一步或返回动作放在左侧，并在右侧显示当前卡片操作。
 * @param props 当前模式允许的导航与操作按钮。
 * @returns 卡片底部操作行。
 * @throws 无预期错误。
 */
export function SetupCardActions({
  onPrevious,
  onOpenTickets,
  onResumeSetup,
  children,
}: SetupCardActionsProps): ReactElement {
  const back = onPrevious ?? onOpenTickets ?? onResumeSetup;
  const backLabel = onPrevious
    ? COPY.previousStep
    : onOpenTickets
      ? TICKET_COPY.returnWorkbench
      : COPY.resumeSetup;
  return (
    <div className="setup-card-actions">
      {back && <Button onClick={back}>{backLabel}</Button>}
      <div className="setup-card-primary">{children}</div>
    </div>
  );
}
