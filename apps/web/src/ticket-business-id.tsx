// 显示可复制的审批编号徽标，只供中栏单据头部使用。
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { writeBrowserClipboard } from './browser-clipboard.ts';
import { TICKET_COPY } from './ticket-copy.ts';

const COPY_FEEDBACK_MS = 1_500;
type CopyFeedback = { kind: 'copied' | 'failed' };
type ScheduleFeedback = (callback: () => void, milliseconds: number) => () => void;

/** 审批编号以及可替换的剪贴板、反馈计时操作。 */
export type TicketBusinessIdProps = {
  businessId: string;
  writeClipboard?: typeof writeBrowserClipboard;
  scheduleFeedback?: ScheduleFeedback;
};

function scheduleBrowserFeedback(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}

/**
 * 点击编号徽标后只复制编号，短暂反馈操作结果。
 * @param props 后台投影的业务编号和可替换的本机操作。
 * @returns 含可聚焦复制按钮的编号徽标。
 * @throws 无预期错误；剪贴板失败转为固定提示。
 */
export function TicketBusinessId({
  businessId,
  writeClipboard = writeBrowserClipboard,
  scheduleFeedback = scheduleBrowserFeedback,
}: TicketBusinessIdProps): ReactElement {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  useEffect(() => {
    if (feedback) return scheduleFeedback(() => setFeedback(null), COPY_FEEDBACK_MS);
  }, [feedback, scheduleFeedback]);
  async function copyBusinessId(): Promise<void> {
    try {
      await writeClipboard(businessId);
      setFeedback({ kind: 'copied' });
    } catch {
      setFeedback({ kind: 'failed' });
    }
  }
  const label = `${TICKET_COPY.businessId} ${businessId}`;
  return (
    <button
      type="button"
      className="ticket-meta-pill ticket-business-id"
      title={TICKET_COPY.copyBusinessId}
      aria-label={`${TICKET_COPY.copyBusinessId} ${businessId}`}
      onClick={() => void copyBusinessId()}
    >
      <span aria-live="polite">
        {feedback?.kind === 'copied'
          ? TICKET_COPY.businessIdCopied
          : feedback?.kind === 'failed'
            ? TICKET_COPY.businessIdCopyFailed
            : label}
      </span>
    </button>
  );
}
