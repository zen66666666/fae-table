// 逐个读取受限 OOXML 部件的 XML 事件，供码表解析器使用；不解析 DTD 或外部实体。
import { AppError } from '../../core/src/index.ts';

const OPEN_TAG = /<([A-Za-z_][\w.:-]*)/uy;
const CLOSE_TAG = /<\/([A-Za-z_][\w.:-]*)\s*>/uy;
const ATTRIBUTE = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/uy;
const TAG_END = /\s*(\/?)>/uy;
const MAX_XML_DEPTH = 64;
const XML_ENTITIES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** XML 起始、结束及文本事件；名称使用本地名，属性保留命名空间前缀。 */
export type XmlEvent =
  | { kind: 'start'; name: string; attributes: ReadonlyMap<string, string> }
  | { kind: 'end'; name: string }
  | { kind: 'text'; text: string };

function createInvalidXmlError(): AppError {
  return new AppError('parse', 'invalid_codetable_xml', 'codetable');
}

function readAt(
  input: string,
  { pattern, index }: { pattern: RegExp; index: number },
): RegExpExecArray | null {
  pattern.lastIndex = index;
  return pattern.exec(input);
}

function getLocalName(name: string): string {
  return name.slice(name.lastIndexOf(':') + 1);
}

function decodeEntity(value: string | undefined): string {
  if (!value) throw createInvalidXmlError();
  const named = XML_ENTITIES.get(value);
  if (named !== undefined) return named;
  if (!/^#(?:x[\da-f]+|\d+)$/iu.test(value)) throw createInvalidXmlError();
  const numeric = value.slice(1);
  const code =
    numeric[0].toLowerCase() === 'x' ? Number.parseInt(numeric.slice(1), 16) : Number(numeric);
  if (
    !(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0x10ffff)) ||
    (code >= 0xd800 && code <= 0xdfff) ||
    code === 0xfffe ||
    code === 0xffff
  )
    throw createInvalidXmlError();
  return String.fromCodePoint(code);
}

function decodeXml(value: string): string {
  // 仅按 XML 固有规则解码一次，用户文本不能声明实体或触发第二次展开。
  return value.replace(/&([^;\s<&]*);|&/gu, (_entity, name: string | undefined) =>
    decodeEntity(name),
  );
}

function readAfter(input: string, { index, end }: { index: number; end: string }): number {
  const position = input.indexOf(end, index);
  if (position === -1) throw createInvalidXmlError();
  return position + end.length;
}

function readOpenTag(
  input: string,
  index: number,
): {
  name: string;
  attributes: Map<string, string>;
  isClosed: boolean;
  next: number;
} {
  const open = readAt(input, { pattern: OPEN_TAG, index });
  if (!open) throw createInvalidXmlError();
  const attributes = new Map<string, string>();
  let next = index + open[0].length;
  while (true) {
    const end = readAt(input, { pattern: TAG_END, index: next });
    if (end)
      return { name: open[1], attributes, isClosed: Boolean(end[1]), next: next + end[0].length };
    const attribute = readAt(input, { pattern: ATTRIBUTE, index: next });
    if (!attribute || attributes.has(attribute[1])) throw createInvalidXmlError();
    attributes.set(attribute[1], decodeXml(attribute[2] ?? attribute[3]));
    next += attribute[0].length;
  }
}

/**
 * 读取属性本地名，供不同命名空间前缀的工作簿关系标识复用。
 * @param attributes 起始事件的属性。
 * @param name 需要的属性本地名。
 * @returns 首个匹配值，缺失时为 undefined。
 * @throws 无预期错误。
 */
export function readXmlAttribute(
  attributes: ReadonlyMap<string, string>,
  name: string,
): string | undefined {
  if (attributes.has(name)) return attributes.get(name);
  for (const [key, value] of attributes) {
    if (getLocalName(key) === name) return value;
  }
  return undefined;
}

/**
 * 逐个产生 XML 事件，检查单一根节点、闭合标签、深度和实体格式。
 * @param input 解压输出上限内的 UTF-8 XML 文本。
 * @returns 只在内存中使用的 XML 事件，不建立完整文档树。
 * @throws AppError 文档格式、结构或实体无效。
 */
export function* readXml(input: string): Generator<XmlEvent, void> {
  // 1. 逐段处理数据与声明。2. 验证标签堆栈。3. 确认根节点完整结束。
  const stack: string[] = [];
  let hasRoot = false;
  let index = 0;
  while (index < input.length) {
    if (input[index] !== '<') {
      // 1.
      const markup = input.indexOf('<', index);
      const end = markup === -1 ? input.length : markup;
      const text = input.slice(index, end);
      if (stack.length) yield { kind: 'text', text: decodeXml(text) };
      else if (text.trim()) throw createInvalidXmlError();
      index = end;
    } else if (input.startsWith('<!--', index)) {
      index = readAfter(input, { index: index + 4, end: '-->' });
    } else if (input.startsWith('<?', index)) {
      index = readAfter(input, { index: index + 2, end: '?>' });
    } else if (input.startsWith('<![CDATA[', index) && stack.length) {
      const end = readAfter(input, { index: index + 9, end: ']]>' });
      yield { kind: 'text', text: input.slice(index + 9, end - 3) };
      index = end;
    } else if (input.startsWith('</', index)) {
      // 2.
      const close = readAt(input, { pattern: CLOSE_TAG, index });
      if (!close || stack.pop() !== close[1]) throw createInvalidXmlError();
      yield { kind: 'end', name: getLocalName(close[1]) };
      index += close[0].length;
    } else {
      if ((!stack.length && hasRoot) || stack.length >= MAX_XML_DEPTH)
        throw createInvalidXmlError();
      // DTD 等其它声明不符合起始标签语法，不能引入文件读取或实体扩展。
      const open = readOpenTag(input, index);
      hasRoot = true;
      const name = getLocalName(open.name);
      yield { kind: 'start', name, attributes: open.attributes };
      if (open.isClosed) yield { kind: 'end', name };
      else stack.push(open.name);
      index = open.next;
    }
  }
  if (!hasRoot || stack.length) throw createInvalidXmlError(); // 3.
}
