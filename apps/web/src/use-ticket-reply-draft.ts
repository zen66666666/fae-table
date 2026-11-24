// 复用单据读取和请求动作管理回复草稿，供当前单据的回复区使用。
import { useCallback, useEffect, useState } from 'react';
import type { TicketDraft, TicketReason } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import type { TicketCommentDraft } from './ticket-local-comments.ts';
import { useRequestAction } from './use-request-action.ts';
import { useTicketRead } from './use-ticket-read.ts';

type DraftReadResult = TicketDraft & { reason: TicketReason };

/** 单据草稿的读取及保存依赖；未选中单据时不发起请求。 */
export type TicketReplyDraftOptions = {
  id: string | null;
  client: WorkbenchClient;
  commentDraft?: TicketCommentDraft;
  onEditAfterSend?: (id: string, text: string) => void;
};

/** 回复区的文本、编辑状态和可重试的草稿操作。 */
export type TicketReplyDraftState = {
  text: string;
  savedText: string;
  updateText: (text: string) => void;
  canEdit: boolean;
  canSave: boolean;
  isSaving: boolean;
  hasSaved: boolean;
  hasReadFailed: boolean;
  hasSaveFailed: boolean;
  reload: () => Promise<void>;
  save: (value?: string) => Promise<void>;
  clearForComment: () => void;
};

function createDraftReadFailure(reason: TicketReason): DraftReadResult {
  return { reason, text: '' };
}

function readCommentDraft(saved: string, attempt: TicketCommentDraft | undefined): string {
  if (!attempt) return saved;
  if (attempt.edited !== null) return attempt.edited;
  // 发出后另外保存的草稿优先；原文仅在证实此次未发送时恢复。
  if (saved && saved !== attempt.saved) return saved;
  return attempt.state === 'failed' ? attempt.original : '';
}

/**
 * 读取并保存后台内存草稿，失败时保留用户当前输入。
 * 1. 复用单据生命周期读取；2. 保存成功时记录确认文本；3. 投影编辑和重试状态。
 * @param options 当前单据标识及同源客户端；调用组件以标识作 key 隔离草稿。
 * @returns 回复文本、操作及安全状态。
 * @throws 无预期错误；网络失败由读取与动作状态承载。
 */
export function useTicketReplyDraft(options: TicketReplyDraftOptions): TicketReplyDraftState {
  // 1. 已读取的文本作为编辑初值，单据切换时废弃前一次读取结果。
  const { id, client, commentDraft, onEditAfterSend } = options;
  const load = useCallback(async (): Promise<DraftReadResult> => {
    const draft = id ? await client.getTicketDraft(id) : { text: '' };
    return { ...draft, reason: 'none' };
  }, [id, client]);
  const read = useTicketRead({ load, createFailure: createDraftReadFailure });
  const [edited, setEdited] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<TicketDraft | null>(null);
  const savedText = confirmed?.text ?? read.result?.text ?? '';
  const text = edited ?? readCommentDraft(savedText, commentDraft);
  const { reload } = read;
  const commentState = commentDraft?.state;
  useEffect(() => {
    // 成功后只回读后台草稿，保留发送期间新输入且未保存的文字。
    if (commentState === 'sent') {
      setConfirmed(null);
      void reload();
    }
  }, [commentState, reload]);
  // 2. 只在请求成功后标为已保存，失败时不清空正在编辑的单据内容。
  const action = useRequestAction<string>({
    perform: async (value) => {
      if (id) setConfirmed(await client.saveTicketDraft({ id, draft: { text: value } }));
    },
  });
  // 3. 先完成读取再开放编辑，避免把尚未加载的已有草稿当成空草稿覆盖。
  const canEdit = Boolean(
    id && !read.isLoading && read.result?.reason === 'none' && !action.isPending,
  );
  return {
    text,
    savedText,
    updateText: (value) => {
      setEdited(value);
      if (id) onEditAfterSend?.(id, value);
    },
    canEdit,
    canSave: canEdit && text !== savedText,
    isSaving: action.isPending,
    hasSaved: confirmed !== null && text === savedText && action.reason === 'none',
    hasReadFailed: read.result !== null && read.result.reason !== 'none',
    hasSaveFailed: action.reason !== 'none',
    reload: read.reload,
    save: (value = text) => action.run(value),
    clearForComment: () => setEdited(null),
  };
}
