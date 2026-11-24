// 展示单据标题下的流程步骤与当前状态，供中栏标题卡片使用。
import type { ReactElement } from 'react';
import type { TicketProgress } from '../../../packages/core/src/index.ts';
import { TICKET_COPY, TICKET_PROGRESS_LABELS } from './ticket-copy.ts';

const COMPLETED_MARK = '✓';

/** 已投影的流程步骤，不含人员和节点标识。 */
export type TicketProgressStripProps = { progress: TicketProgress };

/**
 * 按模板顺序显示步骤，并标注当前步骤的处理状态。
 * @param props 后台推算出的当前流程进度。
 * @returns 可换行的流程步骤条。
 * @throws 无预期错误。
 */
export function TicketProgressStrip({ progress }: TicketProgressStripProps): ReactElement {
  const { steps, currentIndex, state } = progress;
  return (
    <ol className="ticket-progress-strip" aria-label={TICKET_COPY.processProgress}>
      {steps.map(({ name, shortName }, index) => {
        const isCurrent = index === currentIndex;
        const isComplete = index < currentIndex;
        return (
          <li key={name} aria-current={isCurrent ? 'step' : undefined} data-complete={isComplete}>
            {isComplete && <span aria-label={TICKET_COPY.stepComplete}>{COMPLETED_MARK}</span>}
            {shortName}
            {isCurrent && `${TICKET_COPY.countSeparator}${TICKET_PROGRESS_LABELS[state]}`}
          </li>
        );
      })}
    </ol>
  );
}
