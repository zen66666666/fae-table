// 扫描官网返回的有限 HTML，供产品卡片解析使用；这些标签不会作为网页内容执行。

const TAG_START = /<(\/?)([a-z][\w:-]*)(?=[\s/>])/iuy;
const ATTRIBUTES = /([^\s<>=/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/gu;
const HIDDEN_TAGS = new Map(
  ['script', 'style', 'title', 'textarea', 'template', 'noscript'].map((name) => [
    name,
    new RegExp(`</${name}\\s*>`, 'giu'),
  ]),
);
const ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', ' '],
  ['ensp', ' '],
  ['emsp', ' '],
  ['thinsp', ' '],
  ['ndash', '–'],
  ['mdash', '—'],
]);

/** 有限 HTML 标签属性和安全文本事件，只用于识别官网产品卡片。 */
export type HtmlEvent =
  | { kind: 'start'; name: string; attributes: ReadonlyMap<string, string> }
  | { kind: 'end'; name: string }
  | { kind: 'text'; text: string };

function getNumericEntity(name: string): string | undefined {
  if (!/^#(?:x[\da-f]+|\d+)$/iu.test(name)) return undefined;
  const value =
    name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
  return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
    ? String.fromCodePoint(value)
    : '\uFFFD';
}

function decodeHtml(value: string): string {
  // 只解码一次：上游的转义显示文本不会成为新的 HTML 标签。
  return value.replace(
    /&([a-z][\da-z]*|#(?:x[\da-f]+|\d+));/giu,
    (original, name: string) =>
      ENTITIES.get(name.toLowerCase()) ?? getNumericEntity(name) ?? original,
  );
}

function getTagBoundary(html: string, start: number): number {
  let quote = '';
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '<' || character === '>') return index;
  }
  return html.length;
}

function readAttributes(attributes: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of attributes.matchAll(ATTRIBUTES)) {
    const name = match[1].toLowerCase();
    if (!values.has(name)) values.set(name, decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return values;
}

function skipHidden(
  html: string,
  { tag, start }: { tag: string; start: number },
): number | undefined {
  const close = HIDDEN_TAGS.get(tag);
  if (!close) return undefined;
  close.lastIndex = start;
  return close.exec(html) ? close.lastIndex : html.length;
}

/**
 * 依次读取聚焦产品识别的标签与文本，跳过隐藏脚本内容及注释。
 * @param html 通过响应大小限制的官网页面字符串。
 * @returns 内存事件，保留元素及属性顺序，不创建页面树。
 * @throws 不抛出预期错误；无法识别的标记由结果解析器处理。
 */
export function* readHtml(html: string): Generator<HtmlEvent, void> {
  // 1. 遍历文字和标记。2. 读取标签及其属性，跳过不会显示的原始文字区域。
  let index = 0;
  while (index < html.length) {
    const opening = html.indexOf('<', index); // 1.
    const boundary = opening === -1 ? html.length : opening;
    if (boundary > index) yield { kind: 'text', text: decodeHtml(html.slice(index, boundary)) };
    if (opening === -1) return;
    if (html.startsWith('<!--', opening)) {
      const close = html.indexOf('-->', opening + 4);
      index = close === -1 ? html.length : close + 3;
      continue;
    }
    TAG_START.lastIndex = opening; // 2.
    const tag = TAG_START.exec(html);
    if (!tag) {
      index = opening + 1;
      continue;
    }
    const content = TAG_START.lastIndex;
    const end = getTagBoundary(html, content);
    if (html[end] !== '>') {
      index = end;
      continue;
    }
    const name = tag[2].toLowerCase();
    index = end + 1;
    if (tag[1]) yield { kind: 'end', name };
    else {
      const hidden = skipHidden(html, { tag: name, start: index });
      const attributes = readAttributes(html.slice(content, end));
      yield { kind: 'start', name, attributes };
      if (hidden !== undefined) {
        index = hidden;
        yield { kind: 'end', name };
      }
    }
  }
}
