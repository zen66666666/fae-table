// 管理本机评论的显示及回读匹配，供中栏评论提交和沟通记录使用。
import { normalizeTicketWriteText } from '../../../packages/core/src/index.ts';
import type { TicketRecord } from '../../../packages/core/src/index.ts';

type LocalCommentState = 'sending' | 'sent' | 'failed' | 'uncertain';

/** 浏览器内的评论行，仅在本次打开的工作台内显示。 */
export type TicketLocalComment = {
  key: number;
  text: string;
  time: string;
  state: LocalCommentState;
  message?: string;
};

/** 单次提交的原始草稿快照及发送期间后续输入。 */
export type TicketCommentDraft = {
  original: string;
  saved: string;
  edited: string | null;
  state: LocalCommentState;
};

/** 本机评论的回读条件以及对提交前已知记录的计数。 */
export type TicketCommentMatch = {
  local: TicketLocalComment;
  baseline: ReadonlyMap<string, number> | null;
};

type ReadComment = { key: string; time: number; text: string; occurrence: number };

function readOwnComments(records: readonly TicketRecord[]): ReadComment[] {
  const occurrences = new Map<string, number>();
  const comments: ReadComment[] = [];
  for (const record of records) {
    if (record.kind !== 'comment' || !record.isMine || record.comment === null) continue;
    const time = Date.parse(record.time ?? '');
    if (!Number.isFinite(time)) continue;
    const text = normalizeTicketWriteText(record.comment);
    const key = JSON.stringify([time, text]);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    comments.push({ key, time, text, occurrence });
  }
  return comments;
}

/**
 * 捕获发送前已知的本人评论，以便回读时区分同文字的多条评论。
 * @param records 发送前已读取的实际沟通记录。
 * @returns 每种时间和正文组合的已有条数。
 * @throws 无预期错误。
 */
export function countReadTicketComments(records: readonly TicketRecord[]): Map<string, number> {
  return new Map(readOwnComments(records).map(({ key, occurrence }) => [key, occurrence]));
}

/**
 * 将已送达或结果不确定的本机评论与新增回读记录配对。
 * 1. 提取可核实的本人评论；2. 排除旧记录，逐条匹配并记住已用记录。
 * @param options 本机评论、实际回读记录以及每种已匹配条目的序号。
 * @returns 本次由后台记录替换的本机评论编号。
 * @throws 无预期错误。
 */
export function matchReadTicketComments(options: {
  attempts: readonly TicketCommentMatch[];
  records: readonly TicketRecord[];
  claimed: Set<string>;
}): Set<number> {
  // 1. 只匹配具有明确时间和本人身份的评论。
  const records = readOwnComments(options.records);
  const replaced = new Set<number>();
  // 2. 每个新回读条目只替换一次，即使多次发送相同正文。
  for (const { local, baseline } of options.attempts) {
    if (local.state !== 'sent' && local.state !== 'uncertain') continue;
    const submitted = Date.parse(local.time);
    const match = records.find((record) => {
      if (record.text !== local.text) return false;
      // 尚未取得基线时，提交前的记录无法证明本次发送已到达。
      if (
        baseline === null
          ? record.time < submitted
          : record.occurrence <= (baseline.get(record.key) ?? 0)
      )
        return false;
      return !options.claimed.has(JSON.stringify([record.key, record.occurrence]));
    });
    if (!match) continue;
    options.claimed.add(JSON.stringify([match.key, match.occurrence]));
    replaced.add(local.key);
  }
  return replaced;
}
