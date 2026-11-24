// 展示预读权限已经允许的审批操作，供中栏标题卡片使用。
import type { ReactElement } from 'react';
import type { TicketProgress, TicketWriteAction } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { TICKET_WRITE_ACTION_LABELS, TICKET_WRITE_COPY } from './ticket-write-copy.ts';

/** 后台允许的动作及中栏当前写入状态。 */
export type TicketWriteControlsProps = {
  actions: readonly TicketWriteAction[];
  isDisabled: boolean;
  progress?: TicketProgress;
  onSelect: (action: Exclude<TicketWriteAction, 'comment'>) => void;
};

/**
 * 只为能审批的单据显示决策区，拒绝权限由后台单独决定。
 * @param props 后台权限列表、当前禁用状态以及打开确认的动作。
 * @returns 标题旁的审批操作或空内容。
 * @throws 无预期错误。
 */
export function TicketWriteControls({
  actions,
  isDisabled,
  progress,
  onSelect,
}: TicketWriteControlsProps): ReactElement | null {
  if (!actions.includes('approve')) return null;
  const step = progress?.steps[progress.currentIndex];
  const next = progress?.steps[progress.currentIndex + 1];
  const prompt = step
    ? TICKET_WRITE_COPY.formatDecisionStep(step.shortName, progress?.state === 'transferred-to-me')
    : TICKET_WRITE_COPY.decisionPrompt;
  return (
    <div className="ticket-decision">
      <span>{prompt}</span>
      {actions.includes('reject') && (
        <Button
          size="small"
          variant="reject"
          disabled={isDisabled}
          onClick={() => onSelect('reject')}
        >
          {TICKET_WRITE_ACTION_LABELS.reject}
        </Button>
      )}
      <Button
        size="small"
        variant="approve"
        disabled={isDisabled}
        onClick={() => onSelect('approve')}
      >
        {TICKET_WRITE_ACTION_LABELS.approve}
      </Button>
      {next && (
        <span className="ticket-decision-next">
          {TICKET_WRITE_COPY.formatNextStep(next.shortName)}
        </span>
      )}
    </div>
  );
}
