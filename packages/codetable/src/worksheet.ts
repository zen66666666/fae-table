// 逐行读取工作表 XML，将稀疏单元格投影为按列定位的 Excel 文本与数值。
import { AppError } from '../../core/src/index.ts';
import { decodeSpreadsheetText, SpreadsheetText } from './spreadsheet-text.ts';
import { readXml } from './xml.ts';
import type { XmlEvent } from './xml.ts';

const MAX_COLUMN_COUNT = 16_384;
const COLUMN_REFERENCE = /^([A-Z]{1,3})[1-9]\d*$/iu;

/** 字段的显示字符串和原始数值类型标记，可用于识别 Excel 日期序号。 */
export type SpreadsheetCell = { text: string; isNumber: boolean };

/** 一行非空单元格，列序号从零开始。 */
export type SpreadsheetRow = ReadonlyMap<number, SpreadsheetCell>;

function createInvalidWorksheetError(): AppError {
  return new AppError('structure', 'invalid_codetable_worksheet', 'codetable');
}

function readColumn(reference: string | undefined, fallback: number): number {
  if (reference === undefined) {
    if (fallback < MAX_COLUMN_COUNT) return fallback;
    throw createInvalidWorksheetError();
  }
  const letters = COLUMN_REFERENCE.exec(reference)?.[1].toUpperCase();
  if (!letters) throw createInvalidWorksheetError();
  let column = 0;
  for (const letter of letters) column = column * 26 + letter.charCodeAt(0) - 64;
  if (column > MAX_COLUMN_COUNT) throw createInvalidWorksheetError();
  return column - 1;
}

class CellReader {
  readonly column: number;
  private type: string | undefined;
  private raw: string[] = [];
  private isValue = false;
  private text = new SpreadsheetText();

  constructor(attributes: ReadonlyMap<string, string>, fallback: number) {
    this.column = readColumn(attributes.get('r'), fallback);
    this.type = attributes.get('t');
  }

  append(event: XmlEvent): void {
    if (this.type === 'inlineStr') this.text.append(event);
    else if (event.kind === 'text') {
      if (this.isValue) this.raw.push(event.text);
    } else if (event.name === 'v') this.isValue = event.kind === 'start';
  }

  finish(shared: readonly string[]): SpreadsheetCell | undefined {
    const raw = this.raw.join('');
    if (this.type === 'inlineStr') return { text: this.text.getText(), isNumber: false };
    if (!raw || this.type === 'e') return undefined;
    if (this.type === 's') {
      // 共享字符串索引不可超出范围；空字符串本身仍是有效成员。
      const index = /^\d+$/u.test(raw.trim()) ? Number(raw) : -1;
      if (!Number.isSafeInteger(index) || index < 0 || index >= shared.length)
        throw createInvalidWorksheetError();
      return { text: shared[index], isNumber: false };
    }
    return {
      text: decodeSpreadsheetText(raw),
      isNumber: this.type === undefined || this.type === 'n',
    };
  }
}

/**
 * 逐个解析工作表中显式出现的行和单元格，保留合并列下方的其余字段。
 * @param options 工作表 XML 和共享字符串表。
 * @returns 按原顺序产生的非空行，单元格位置依据 Excel 的列引用。
 * @throws AppError 文档或关键的单元格结构无效。
 */
export function* readWorksheetRows(options: {
  xml: string;
  sharedStrings: readonly string[];
}): Generator<SpreadsheetRow, void> {
  // 1. 跟踪数据区中显式的行和列。2. 解码每个单元格。3. 不要求合并列重复出现。
  let isSheetData = false;
  let row: Map<number, SpreadsheetCell> | undefined;
  let cell: CellReader | undefined;
  let nextColumn = 0;
  for (const event of readXml(options.xml)) {
    if (event.kind !== 'text' && event.name === 'sheetData') {
      isSheetData = event.kind === 'start'; // 1.
    } else if (!isSheetData) continue;
    else if (event.kind === 'start' && event.name === 'row') {
      if (row) throw createInvalidWorksheetError();
      row = new Map();
      nextColumn = 0;
    } else if (event.kind === 'start' && event.name === 'c' && row) {
      if (cell) throw createInvalidWorksheetError();
      cell = new CellReader(event.attributes, nextColumn);
      nextColumn = cell.column + 1;
    } else if (event.kind === 'end' && event.name === 'c' && row && cell) {
      const value = cell.finish(options.sharedStrings); // 2.
      if (value !== undefined) row.set(cell.column, value);
      cell = undefined;
    } else if (event.kind === 'end' && event.name === 'row' && row) {
      // 3. 软件类别等首列可能纵向合并，后续行仍有自己的型号及责任人。
      if (row.size) yield row;
      row = undefined;
    } else cell?.append(event);
  }
}
