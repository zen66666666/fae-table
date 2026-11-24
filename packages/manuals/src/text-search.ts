// 从有界的本机手册文本中选出与当前问题相关的引文，供后台 AI 问答使用。
import {
  MANUAL_SNIPPET_CHAR_LIMIT,
  MANUAL_SNIPPET_LIMIT,
  MANUAL_SNIPPET_TEXT_LIMIT,
} from './text-limits.ts';
import type { ManualTextSnippet, ParsedManualText } from './text-types.ts';

const QUERY_CHAR_LIMIT = 2_000;
const QUERY_TERM_LIMIT = 160;
const WINDOW_OVERLAP_CHARS = 120;
const MIN_LAST_SNIPPET_CHARS = 80;
const TERM_PATTERN = /[a-z0-9]+(?:[._/+\-][a-z0-9]+)*|\p{Script=Han}+/gu;
const HAN_CHARACTER = /^\p{Script=Han}$/u;
const HAN_SPACE = /(\p{Script=Han})[^\S\n]+(?=\p{Script=Han})/gu;
const COMMON_TERMS = new Set([
  'the',
  'and',
  'are',
  'for',
  'from',
  'how',
  'is',
  'of',
  'or',
  'to',
  'what',
  'with',
  '什么',
  '如何',
  '怎么',
  '一下',
  '请问',
  '这个',
  '那个',
  '可以',
  '是否',
  '多少',
  '需要',
]);

type TextDocument = {
  fileName: string;
  pages: NonNullable<ParsedManualText['pages']>;
};
type RankedSnippet = ManualTextSnippet & { score: number; offset: number };

function getTerms(text: string): Map<string, number> {
  const terms = new Map<string, number>();
  const normalized = text.normalize('NFKC').toLowerCase().replace(HAN_SPACE, '$1');
  for (const [term] of normalized.matchAll(TERM_PATTERN)) {
    const characters = Array.from(term);
    if (HAN_CHARACTER.test(characters[0])) {
      for (let index = 0; index < characters.length - 1; index++) {
        const pair = characters[index] + characters[index + 1];
        if (!COMMON_TERMS.has(pair)) terms.set(pair, 2);
      }
    } else if (!COMMON_TERMS.has(term)) {
      // 保留产品号和专业术语整体；分隔出的编号也可匹配询问的一部分，但权重更低。
      const weight = term.length > 1 ? 4 : 1;
      terms.set(term, weight);
      for (const part of term.split(/[._/+\-]/u)) {
        if (!terms.has(part) && part.length > 1 && !COMMON_TERMS.has(part)) terms.set(part, 2);
      }
    }
  }
  return terms;
}

function getScore(terms: ReadonlyMap<string, number>, text: string): number {
  const matches = getTerms(text);
  let score = 0;
  for (const [term, weight] of terms) {
    const matchWeight = matches.get(term);
    if (matchWeight) score += Math.min(weight, matchWeight);
  }
  return score;
}

function rankPage(options: {
  fileName: string;
  page: number;
  text: string;
  terms: ReadonlyMap<string, number>;
}): RankedSnippet[] {
  const { fileName, page, terms } = options;
  const text = options.text.replace(/[^\S\n]+/gu, ' ');
  const candidates: RankedSnippet[] = [];
  for (let offset = 0; offset < text.length; ) {
    const upperBound = Math.min(text.length, offset + MANUAL_SNIPPET_CHAR_LIMIT);
    const lineEnd = text.lastIndexOf('\n', upperBound - 1);
    const end =
      lineEnd > upperBound - WINDOW_OVERLAP_CHARS && upperBound < text.length
        ? lineEnd
        : upperBound;
    const excerpt = text.slice(offset, end).trim();
    const score = getScore(terms, excerpt);
    if (score > 0) candidates.push({ fileName, page, text: excerpt, score, offset });
    if (end === text.length) break;
    offset = end - WINDOW_OVERLAP_CHARS;
  }
  return candidates;
}

/**
 * 按中英文与编号词项相关性挑选引文，保留实际文件名与页号。
 * @param options 用户问题以及已经验证并提取的本机手册文本页。
 * @returns 有界、按相关性排列的引文；没有命中时返回空数组。
 * @throws 无预期错误。
 */
export function selectManualSnippets(options: {
  question: string;
  documents: readonly TextDocument[];
}): ManualTextSnippet[] {
  // 1. 取问题词项。2. 以文本窗口评分。3. 去掉同页重叠窗口并限制引文总量。
  const terms = new Map(
    [...getTerms(options.question.slice(0, QUERY_CHAR_LIMIT))].slice(0, QUERY_TERM_LIMIT),
  ); // 1.
  if (!terms.size) return [];
  const ranked = options.documents // 2.
    .flatMap(({ fileName, pages }) =>
      pages.flatMap((page) => rankPage({ fileName, ...page, terms })),
    )
    .sort((left, right) => right.score - left.score);
  const selected: RankedSnippet[] = [];
  let remaining = MANUAL_SNIPPET_TEXT_LIMIT;
  for (const item of ranked) {
    // 3. 邻近窗口包含相同引文时只保留分数更高的一个。
    if (
      selected.some(
        (prior) =>
          prior.fileName === item.fileName &&
          prior.page === item.page &&
          Math.abs(prior.offset - item.offset) < MANUAL_SNIPPET_CHAR_LIMIT,
      )
    )
      continue;
    selected.push({ ...item, text: item.text.slice(0, remaining).trimEnd() });
    remaining -= item.text.length;
    if (selected.length >= MANUAL_SNIPPET_LIMIT || remaining < MIN_LAST_SNIPPET_CHARS) break;
  }
  return selected.map(({ fileName, page, text }) => ({ fileName, page, text }));
}
