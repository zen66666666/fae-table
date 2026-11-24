// 维护直接评论及草稿的网页内存状态，供中栏跨单据切换使用。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  normalizeTicketWriteText,
  TICKET_WRITE_TEXT_LIMIT,
} from '../../../packages/core/src/index.ts';
import type { TicketRecord, TicketWriteOutcome } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import { countReadTicketComments, matchReadTicketComments } from './ticket-local-comments.ts';
import type {
  TicketCommentDraft,
  TicketCommentMatch,
  TicketLocalComment,
} from './ticket-local-comments.ts';
import { getTicketWriteOutcomeLabel, TICKET_WRITE_COPY } from './ticket-write-copy.ts';

type LocalCommentView = { comments: readonly TicketLocalComment[]; draft: TicketCommentDraft };
type CommentMemory = {
  attempts: TicketCommentMatch[];
  draft: TicketCommentDraft | null;
  claimed: Set<string>;
  records: readonly TicketRecord[] | null;
};
type SendComment = { id: string; text: string; savedText: string };

/** 当前账号网页内的直接评论及其回读、发送和编辑操作。 */
export type TicketComments = {
  views: ReadonlyMap<string, LocalCommentView>;
  observeRecords: (id: string, records: readonly TicketRecord[]) => void;
  updateDraft: (id: string, text: string) => void;
  send: (options: SendComment) => number | null;
};

/**
 * 校验可直接发送的评论文本，避免发送空评论或超长正文。
 * @param text 回复区的原始文字。
 * @returns 规范化后仍有可发送内容时为 true。
 * @throws 无预期错误。
 */
export function canSendTicketComment(text: string): boolean {
  return text.length <= TICKET_WRITE_TEXT_LIMIT && Boolean(normalizeTicketWriteText(text));
}

function readMemory(tickets: Map<string, CommentMemory>, id: string): CommentMemory {
  const existing = tickets.get(id);
  if (existing) return existing;
  const memory: CommentMemory = { attempts: [], draft: null, claimed: new Set(), records: null };
  tickets.set(id, memory);
  return memory;
}

function readMatchingComments(memory: CommentMemory): boolean {
  if (!memory.records || !memory.attempts.length) return false;
  const matched = matchReadTicketComments({
    attempts: memory.attempts,
    records: memory.records,
    claimed: memory.claimed,
  });
  if (!matched.size) return false;
  memory.attempts = memory.attempts.filter(({ local }) => !matched.has(local.key));
  return true;
}

async function sendDirectComment(options: {
  id: string;
  text: string;
  client: WorkbenchClient;
  isActive: () => boolean;
}): Promise<TicketWriteOutcome | null> {
  const { id, text, client, isActive } = options;
  let prepared;
  try {
    // 1. 只准备用户刚点击发送的正文，旧请求的核实结果不会触发新写入。
    prepared = await client.prepareTicketWrite({ id, action: 'comment', text });
  } catch {
    return { kind: 'not-completed' };
  }
  if (!isActive()) return null;
  if (prepared.kind !== 'ready') {
    if (prepared.kind === 'completed') return { kind: 'previous-completed' };
    if (prepared.kind === 'uncertain' || prepared.isConfirmationUsed)
      return { kind: 'previous-uncertain' };
    return prepared;
  }
  if (prepared.summary.action !== 'comment' || prepared.summary.text !== text)
    return { kind: 'invalid-confirmation' };
  // 2. 确认码只消费一次；无法收到响应时不能断定没有发出。
  try {
    return await client.executeTicketWrite({ id, code: prepared.code });
  } catch {
    return { kind: 'uncertain' };
  }
}

function settleComment(options: {
  memory: CommentMemory;
  local: TicketLocalComment;
  outcome: TicketWriteOutcome;
}): void {
  const { memory, local, outcome } = options;
  const state =
    outcome.kind === 'completed'
      ? 'sent'
      : outcome.kind === 'uncertain' || outcome.isConfirmationUsed
        ? 'uncertain'
        : 'failed';
  const reason = state === 'failed' ? getTicketWriteOutcomeLabel(outcome) : undefined;
  memory.attempts = memory.attempts.map((attempt) =>
    attempt.local === local ? { ...attempt, local: { ...local, state, message: reason } } : attempt,
  );
  if (memory.draft) memory.draft = { ...memory.draft, state };
  if (state !== 'failed') readMatchingComments(memory);
}

/**
 * 收集选中单据的真实评论，将本机发送状态保留在页面层。
 * 1. 启动一次发送并清出编辑空间；2. 接收结果；3. 用新读到的真实记录替换本机行。
 * @param options 同源客户端、可替换时间和供左侧只读重载的成功回调。
 * @returns 各单据的本机评论、草稿快照及发送操作。
 * @throws 无预期错误；准备和执行异常分别映射到未发送或结果不确定。
 */
export function useTicketComments(options: {
  client: WorkbenchClient;
  now: () => number;
  onCompleted?: () => Promise<void>;
}): TicketComments {
  const { client, now, onCompleted } = options;
  const memory = useRef(new Map<string, CommentMemory>());
  const nextKey = useRef(0);
  const isActive = useRef(false);
  const [views, setViews] = useState(new Map<string, LocalCommentView>());
  useEffect(() => {
    isActive.current = true;
    return () => {
      isActive.current = false;
    };
  }, []);
  const publish = useCallback((id: string, ticket: CommentMemory): void => {
    if (!ticket.draft) return;
    const view = { comments: ticket.attempts.map(({ local }) => local), draft: ticket.draft };
    setViews((current) => new Map(current).set(id, view));
  }, []);
  return {
    views,
    // 3. 最新快照既可匹配已完成的发送，也为下一次发送保留历史基线。
    observeRecords: useCallback(
      (id, records) => {
        const ticket = readMemory(memory.current, id);
        ticket.records = records;
        if (readMatchingComments(ticket)) publish(id, ticket);
      },
      [publish],
    ),
    updateDraft: (id, text) => {
      const ticket = memory.current.get(id);
      if (!ticket?.draft) return;
      ticket.draft = { ...ticket.draft, edited: text };
      publish(id, ticket);
    },
    send: ({ id, text, savedText }) => {
      const ticket = readMemory(memory.current, id);
      if (!isActive.current || ticket.draft?.state === 'sending' || !canSendTicketComment(text))
        return null;
      // 1. 先同步占用本单据，再显示本机行，避免 React 重绘前的重复点击。
      const local: TicketLocalComment = {
        key: ++nextKey.current,
        text: normalizeTicketWriteText(text),
        time: new Date(now()).toISOString(),
        state: 'sending',
      };
      ticket.attempts.push({
        local,
        baseline: ticket.records ? countReadTicketComments(ticket.records) : null,
      });
      ticket.draft = { original: text, saved: savedText, edited: null, state: 'sending' };
      publish(id, ticket);
      // 2. 结果按原单据保存，用户切换单据时不影响发送或覆盖当前输入。
      void sendDirectComment({
        id,
        text: local.text,
        client,
        isActive: () => isActive.current,
      }).then((outcome) => {
        if (!isActive.current || !outcome) return;
        settleComment({ memory: ticket, local, outcome });
        publish(id, ticket);
        if (outcome.kind === 'completed' || outcome.kind === 'previous-completed')
          void onCompleted?.();
      });
      return local.key;
    },
  };
}
