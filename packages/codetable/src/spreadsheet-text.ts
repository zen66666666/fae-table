// 还原共享与内联字符串，供 OOXML 工作表读取器复用。
import { readXml } from './xml.ts';
import type { XmlEvent } from './xml.ts';

const EXCEL_ESCAPE = /_x([\da-f]{4})_/giu;

/**
 * 解码 Excel 的单次字符串转义，保留原有文本与换行。
 * @param value XML 实体已经解码的文本。
 * @returns Excel 字符转义还原后的显示文本。
 * @throws 无预期错误。
 */
export function decodeSpreadsheetText(value: string): string {
  return value.replace(EXCEL_ESCAPE, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** 保存一个 Excel 富文本字符串的显示片段，忽略用于注音的文本。 */
export class SpreadsheetText {
  private parts: string[] = [];
  private isText = false;
  private isPhonetic = false;

  /**
   * 读取当前共享或内联字符串内的一个 XML 事件。
   * @param event 目标字符串范围内的事件。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  append(event: XmlEvent): void {
    if (event.kind === 'text') {
      if (this.isText && !this.isPhonetic) this.parts.push(event.text);
      return;
    }
    if (event.name === 't') this.isText = event.kind === 'start';
    if (event.name === 'rPh') this.isPhonetic = event.kind === 'start';
  }

  /**
   * 合并同一单元格的普通文本或多个富文本片段。
   * @returns 原顺序的单元格显示文本。
   * @throws 无预期错误。
   */
  getText(): string {
    return decodeSpreadsheetText(this.parts.join(''));
  }
}

/**
 * 按存储顺序读取共享字符串表，以供工作表从零开始的引用解析。
 * @param xml 共享字符串表的 XML。
 * @returns 保持原索引的共享文本列表。
 * @throws AppError 文档 XML 格式无效。
 */
export function readSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  let current: SpreadsheetText | undefined;
  for (const event of readXml(xml)) {
    if (event.kind === 'start' && event.name === 'si') current = new SpreadsheetText();
    else if (event.kind === 'end' && event.name === 'si' && current) {
      strings.push(current.getText());
      current = undefined;
    } else current?.append(event);
  }
  return strings;
}
