// 解析 AI 回答中的展示标记和页码，供回答渲染、复制和追加回复复用。

const PAGE_CITATION = /【第\s*(\d+)\s*页】/gu;
const LIST_ITEM = /^\s*([-+*]|\d+[.)])\s+(\S.*)$/u;
const QUOTE_PREFIX = /^(?:[\t ]*>[\t ]?)+/u;
const HEADING_PREFIX = /^\s{0,3}#{1,6}(?:[\t ]+|$)/u;
const HEADING_SUFFIX = /[\t ]+#+[\t ]*$/u;
const FENCE_START = /^[\t ]*(`{3,}|~{3,})[\t ]*[\w.+-]*[\t ]*$/u;
const FENCE_END = /^[\t ]*(`{3,}|~{3,})[\t ]*$/u;
const HORIZONTAL_RULE = /^\s*(?:(?:-[\t ]*){3,}|(?:\*[\t ]*){3,}|(?:_[\t ]*){3,})$/u;
const MAX_INLINE_NESTING = 4;
const INLINE_MARK = new RegExp(
  [
    /\\(?<literal>[\\`*_~#[\]()!>])/u,
    /(?<!`)(?<ticks>`+)(?<code>[^`\r\n]+)\k<ticks>/u,
    /!?\[(?<label>[^\[\]\r\n]*)\]\((?:[^()\r\n]|\([^()\r\n]*\))*\)/u,
    /(?<strong>\*{2,3})(?<bold>(?:(?!\*\*)[^\r\n])+?)\k<strong>/u,
    /~~(?<struck>[^~\r\n]+)~~/u,
    /(?<![\p{L}\p{N}_])__(?<doubled>[^_\r\n]+)__(?![\p{L}\p{N}_])/u,
    /(?<![A-Za-z\d_*])\*(?![\s*])(?<italic>[^*\r\n]+?)(?<!\s)\*(?![A-Za-z\d*])/u,
    /(?<![\p{L}\p{N}_])_(?<underscored>[^_\r\n]+)_(?![\p{L}\p{N}_])/u,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
  'gu',
);

/** 安全展示的行内文本；只允许为成对星号中的内容启用加粗。 */
export type AiInlinePart = { text: string; isBold: boolean };

/** 保留段落和简单列表；每一行由已经移除展示标记的片段组成。 */
export type AiTextBlock = {
  kind: 'paragraph' | 'ordered' | 'unordered';
  lines: AiInlinePart[][];
};

/** 文本片段；page 只出现在经过实际 PDF 页数核验的引用上。 */
export type AiCitationPart = { text: string; page?: number };

type AiTextLine = { kind: AiTextBlock['kind']; parts: AiInlinePart[] };

function parseInline(
  text: string,
  options: { isBold?: boolean; depth?: number } = {},
): AiInlinePart[] {
  const { isBold = false, depth = 0 } = options;
  // 只提取文字和加粗标志；嵌套上限避免长回答造成过深递归。
  if (depth >= MAX_INLINE_NESTING) return [{ text, isBold }];
  const parts: AiInlinePart[] = [];
  let offset = 0;
  for (const match of text.matchAll(INLINE_MARK)) {
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), isBold });
    const { literal, code, bold, label, struck, doubled, italic, underscored } = match.groups ?? {};
    if (literal !== undefined || code !== undefined) {
      parts.push({ text: literal ?? code, isBold });
    } else {
      const words = bold ?? label ?? struck ?? doubled ?? italic ?? underscored ?? '';
      parts.push(...parseInline(words, { isBold: isBold || bold !== undefined, depth: depth + 1 }));
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), isBold });
  return parts;
}

function parseTextLine(line: string): AiTextLine {
  if (HORIZONTAL_RULE.test(line)) return { kind: 'paragraph', parts: [] };
  if (HEADING_PREFIX.test(line)) {
    const heading = line.replace(HEADING_PREFIX, '').replace(HEADING_SUFFIX, '');
    return { kind: 'paragraph', parts: parseInline(heading) };
  }
  const item = LIST_ITEM.exec(line);
  const kind = item ? (item[1].length === 1 ? 'unordered' : 'ordered') : 'paragraph';
  return { kind, parts: parseInline(item ? item[2] : line) };
}

function parseTextLines(text: string): AiTextLine[] {
  // 1. 忽略围栏本身，保留其中有意义的代码字符。2. 清理普通行标记并识别列表。
  const lines: AiTextLine[] = [];
  let fence: string | undefined;
  for (const original of text.split(/\r?\n/u)) {
    const line = original.replace(QUOTE_PREFIX, '');
    if (fence) {
      const closing = FENCE_END.exec(line)?.[1]; // 1.
      if (closing?.[0] === fence[0] && closing.length >= fence.length) fence = undefined;
      else lines.push({ kind: 'paragraph', parts: [{ text: original, isBold: false }] });
      continue;
    }
    fence = FENCE_START.exec(line)?.[1];
    if (!fence) lines.push(parseTextLine(line)); // 2.
  }
  return lines;
}

/**
 * 将模型回答拆为纯文本段落和连续列表，保留加粗所需的文字片段。
 * @param text 助手回答。
 * @returns 按原顺序排列的文本块与行内片段。
 * @throws 无预期错误。
 */
export function parseAiTextBlocks(text: string): AiTextBlock[] {
  const blocks: AiTextBlock[] = [];
  let current: AiTextBlock | undefined;
  for (const { kind, parts } of parseTextLines(text)) {
    if (!parts.some(({ text }) => text.trim())) {
      current = undefined;
      continue;
    }
    if (current?.kind !== kind) {
      current = { kind, lines: [] };
      blocks.push(current);
    }
    current.lines.push(parts);
  }
  return blocks;
}

/**
 * 在纯文本中标出可以跳转的页码，越界或不合法的标记原样显示。
 * @param options 待渲染行及 PDF 的实际页数。
 * @returns 保序片段，只有通过页数检查的片段带页码。
 * @throws 无预期错误。
 */
export function parseAiCitationParts(options: {
  text: string;
  manualPageCount: number;
}): AiCitationPart[] {
  const { text, manualPageCount } = options;
  if (!Number.isSafeInteger(manualPageCount) || manualPageCount < 1) return [{ text }];
  const parts: AiCitationPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(PAGE_CITATION)) {
    const page = Number(match[1]);
    // 上游只能建议页码；真正的链接始终根据当前单据和已核实页数构造。
    if (!Number.isSafeInteger(page) || page < 1 || page > manualPageCount) continue;
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: match[0], page });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

/**
 * 将回答转换为剪贴板和回复框共用的纯文字，移除展示标记和页码引用。
 * @param text 助手回答的原始纯文本。
 * @returns 去除展示、引用标记及多余边缘空白的文字。
 * @throws 无预期错误。
 */
export function formatAiPlainAnswer(text: string): string {
  return parseTextLines(text)
    .map(({ parts }) => parts.map((part) => part.text).join(''))
    .join('\n')
    .replace(PAGE_CITATION, '')
    .replace(/[\t ]+$/gmu, '')
    .trim();
}
