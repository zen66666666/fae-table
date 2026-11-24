// 管理单据写回的可编辑核对和一次性确认，供中栏回复区使用。
import { useEffect, useRef, useState } from 'react';
import {
  normalizeTicketWriteText,
  TICKET_WRITE_TEXT_LIMIT,
} from '../../../packages/core/src/index.ts';
import type {
  TicketWriteAction,
  TicketWriteOutcome,
  TicketWritePreparation,
} from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import {
  getTicketWriteOutcomeLabel,
  TICKET_WRITE_COPY,
  TICKET_WRITE_OUTCOME_LABELS,
} from './ticket-write-copy.ts';

type PreparedWrite = Extract<TicketWritePreparation, { kind: 'ready' }>;
type PendingOperation = 'prepare' | 'execute' | 'refresh';
type ActiveReview = TicketWriteReview & { operation: PendingOperation | null; message: string };
type ReviewSession = {
  visible: ActiveReview | null;
  getCurrent: () => ActiveReview | null;
  update: (next: ActiveReview | null) => void;
};
type ReviewOperation = TicketWriteOptions & { session: ReviewSession };

/** 已选动作、可编辑文字和只在当前文本下可用的一次性确认。 */
export type TicketWriteReview = {
  action: Exclude<TicketWriteAction, 'comment'>;
  text: string;
  ticketName: string | null;
  detailReadAt: string | null;
  prepared: PreparedWrite | null;
  /** 现场核对发现流程变化后，此次确认只保留内容供查看。 */
  isStale?: true;
};

/** 当前单据的安全写回结果，可在单据离开列表后继续显示。 */
export type TicketWriteResultEvent = {
  id: string;
  outcome: TicketWriteOutcome;
};

/** 当前单据、服务端允许的动作和执行结果入口。 */
export type TicketWriteOptions = {
  id: string | null;
  client: WorkbenchClient;
  actions: TicketWriteAction[];
  isBusy: boolean;
  isRefreshingTicket: boolean;
  onRefreshTicket: () => Promise<void>;
  onResult: (event: TicketWriteResultEvent) => void;
};

/** 中栏写回表单的全部可见状态和用户操作。 */
export type TicketWriteState = {
  review: TicketWriteReview | null;
  message: string;
  isPreparing: boolean;
  isExecuting: boolean;
  isRefreshing: boolean;
  canConfirm: boolean;
  begin: (action: TicketWriteAction, text: string) => void;
  updateText: (text: string) => void;
  confirm: () => Promise<void>;
  refresh: () => Promise<void>;
  cancel: () => void;
};

function getTextError(action: TicketWriteAction, text: string): string {
  if (text.length > TICKET_WRITE_TEXT_LIMIT) return TICKET_WRITE_COPY.textTooLong;
  if (action === 'approve' || normalizeTicketWriteText(text)) return '';
  return TICKET_WRITE_OUTCOME_LABELS['text-required'];
}

function matchesPrepared(review: TicketWriteReview, prepared: PreparedWrite): boolean {
  return (
    prepared.summary.action === review.action &&
    prepared.summary.text === normalizeTicketWriteText(review.text)
  );
}

function useReviewSession(options: Pick<TicketWriteOptions, 'id' | 'client'>): ReviewSession {
  const { id, client } = options;
  const [visible, setVisible] = useState<ActiveReview | null>(null);
  const active = useRef<ActiveReview | null>(null);
  useEffect(() => {
    setVisible(null);
    return () => {
      active.current = null;
    };
  }, [id, client]);
  function update(next: ActiveReview | null): void {
    // 同步更新防止 React 重绘前的重复点击或编辑后点击旧确认。
    active.current = next;
    setVisible(next);
  }
  return { visible, getCurrent: () => active.current, update };
}

function canAct(review: ActiveReview | null, options: TicketWriteOptions): review is ActiveReview {
  return Boolean(
    review &&
      !review.isStale &&
      !review.operation &&
      !options.isBusy &&
      !options.isRefreshingTicket &&
      options.actions.includes(review.action),
  );
}

async function prepareReview(options: ReviewOperation): Promise<ActiveReview | null> {
  const { id, client, session, onResult } = options;
  const current = session.getCurrent();
  if (!id || !canAct(current, options) || current.prepared) return null;
  const error = getTextError(current.action, current.text);
  if (error) {
    session.update({ ...current, message: error });
    return null;
  }
  const preparing: ActiveReview = { ...current, operation: 'prepare', message: '' };
  session.update(preparing);
  try {
    const result = await client.prepareTicketWrite({
      id,
      action: current.action,
      text: current.text,
    });
    // 相同对象表示同一次核对；取消或切单后的响应不能再回到对话框。
    if (session.getCurrent() !== preparing) return null;
    if (result.kind === 'ready' && matchesPrepared(current, result)) {
      const revised = {
        ...current,
        ticketName: result.summary.ticketName,
        detailReadAt: result.summary.detailReadAt,
        text: result.summary.text,
        prepared: result,
      };
      session.update(revised);
      return revised;
    } else if (result.kind === 'previous-completed' || result.kind === 'completed') {
      // 后台已核实先前不确定的请求。本次没有执行新的写入。
      onResult({ id, outcome: result });
      session.update(null);
    } else {
      const outcome = result.kind === 'ready' ? { kind: 'invalid-confirmation' as const } : result;
      session.update({ ...current, message: getTicketWriteOutcomeLabel(outcome) });
    }
  } catch {
    if (session.getCurrent() === preparing) {
      session.update({ ...current, message: TICKET_WRITE_COPY.checkingFailed });
    }
  }
  return null;
}

async function confirmReview(options: ReviewOperation): Promise<void> {
  const { id, client, session, onResult } = options;
  const current = session.getCurrent();
  if (!id || !canAct(current, options) || getTextError(current.action, current.text)) return;
  // 编辑意见后直接用确认点击绑定新的本机确认码，等候时取消不会误提交另一次核对。
  const ready = current.prepared ? current : await prepareReview(options);
  if (!ready?.prepared || session.getCurrent() !== ready) return;
  // 先移除本地确认码，再发送一次。网络异常也不能用同一个码再提交。
  const executing: ActiveReview = { ...ready, prepared: null, operation: 'execute', message: '' };
  session.update(executing);
  let outcome: TicketWriteOutcome;
  try {
    outcome = await client.executeTicketWrite({ id, code: ready.prepared.code });
  } catch {
    outcome = { kind: 'uncertain' };
  }
  // 即使列表已经移除了本单据，也把结果交给中栏保留。
  onResult({ id, outcome });
  if (session.getCurrent() !== executing) return;
  if (outcome.kind === 'completed') {
    session.update(null);
    return;
  }
  session.update({
    ...executing,
    operation: null,
    message: getTicketWriteOutcomeLabel(outcome),
    isStale: outcome.kind === 'changed' ? true : undefined,
  });
}

async function refreshReview(options: ReviewOperation): Promise<void> {
  const { session, onRefreshTicket } = options;
  const current = session.getCurrent();
  if (!current || current.operation || options.isRefreshingTicket) return;
  // 更新期间撤销旧确认，避免用户用更新前的意见与任务快照执行。
  const refreshing: ActiveReview = { ...current, prepared: null, operation: 'refresh' };
  session.update(refreshing);
  try {
    await onRefreshTicket();
    if (session.getCurrent() !== refreshing) return;
    session.update({ ...refreshing, operation: null, isStale: undefined });
    await prepareReview(options);
  } catch {
    if (session.getCurrent() === refreshing)
      session.update({ ...refreshing, operation: null, message: TICKET_WRITE_COPY.checkingFailed });
  }
}

/**
 * 每次核对绑定实际动作和文字。改动、取消、切单和执行都会撤销当前确认。
 * 1. 维护核对范围与同步锁；2. 向后台核对实际内容；3. 仅显式确认时消费一次性码。
 * @param options 当前单据、允许动作及结果回调。
 * @returns 可编辑核对、确认和安全反馈。
 * @throws 无预期错误；无法确认执行结果时提示用户到钉钉核对。
 */
export function useTicketWrite(options: TicketWriteOptions): TicketWriteState {
  const { id, actions, isBusy, isRefreshingTicket } = options;
  // 1. 当前核对对象同时区分待确认、已编辑和正在进行的网络请求。
  const session = useReviewSession(options);
  const review = session.visible;
  const canActOnReview = canAct(review, options);
  // 2. 准备只绑定所选意图。先拿到本机确认码再弹出对话框，避免打开后等待。
  const operation = { ...options, session };
  const isPreparing = review?.operation === 'prepare';
  const isPreparingFirstReview = isPreparing && review.ticketName === null;
  return {
    review: isPreparingFirstReview ? null : review,
    message: review?.message ?? '',
    // 3. 用户显式确认后才将与当前文字绑定的码交给后台。
    confirm: () => confirmReview(operation),
    refresh: () => refreshReview(operation),
    isPreparing,
    isExecuting: review?.operation === 'execute',
    isRefreshing: isRefreshingTicket || review?.operation === 'refresh',
    canConfirm: canActOnReview && !getTextError(review.action, review.text),
    begin: (action, text) => {
      if (
        action === 'comment' ||
        !id ||
        session.getCurrent() ||
        isBusy ||
        !actions.includes(action)
      )
        return;
      session.update({
        action,
        text,
        ticketName: null,
        detailReadAt: null,
        prepared: null,
        operation: null,
        message: '',
      });
      void prepareReview(operation);
    },
    updateText: (text) => {
      const current = session.getCurrent();
      if (!current || current.isStale || current.operation || current.text === text) return;
      session.update({
        ...current,
        text,
        prepared: null,
        message: getTextError(current.action, text),
      });
    },
    cancel: () => {
      if (session.getCurrent()?.operation !== 'execute') session.update(null);
    },
  };
}
