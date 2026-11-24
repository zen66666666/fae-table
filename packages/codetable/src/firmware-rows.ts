// 按码表表头投影各页的型号与固件记录，供内存查询索引使用。
import { AppError } from '../../core/src/index.ts';
import { readArchiveDate } from './excel-date.ts';
import { readWorksheetRows } from './worksheet.ts';
import type { SpreadsheetCell, SpreadsheetRow } from './worksheet.ts';

const HEADERS = {
  softwareCategory: '软件类别',
  classification: '分类码',
  code: '编号',
  productType: '产品类型',
  model: '产品型号',
  chip: '芯片型号',
  projectCode: '项目编号',
  summary: '功能简述',
  archivedAt: '归档日期',
  person: '责任人',
  notes: '备注',
} as const;
const HEADER_BY_LABEL = new Map<string, keyof typeof HEADERS>(
  Object.entries(HEADERS).map(([key, label]) => [label, key as keyof typeof HEADERS]),
);
const MODEL_SEPARATOR = /[/,、]/u;
const UNKNOWN_PERSON = /^\?+$/u;

type Columns = Partial<Record<keyof typeof HEADERS, number>>;

/** 从一条工作表数据行读取的型号、责任人及归档公开字段。 */
export type FirmwareRow = {
  models: string[];
  person: string | null;
  archivedAt: string | null;
  code: string | null;
  chip: string | null;
  summary: string | null;
};

/**
 * 规范化单据和表中型号以便精确或前缀比较。
 * @param model 原始型号文本。
 * @returns 去空白、转半角并大写后的型号键。
 * @throws 无预期错误。
 */
export function normalizeModel(model: string): string {
  return model.normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
}

function readModels(value: string): string[] {
  // 先转半角再拆分，避免全角斜线和逗号作为型号的一部分。
  return [...new Set(normalizeModel(value).split(MODEL_SEPARATOR).filter(Boolean))];
}

function getColumns(row: SpreadsheetRow): Columns | undefined {
  const columns: Columns = {};
  for (const [column, cell] of row) {
    const header = HEADER_BY_LABEL.get(cell.text.replace(/\s+/gu, ''));
    if (header && columns[header] === undefined) columns[header] = column;
  }
  return columns.model === undefined || columns.person === undefined ? undefined : columns;
}

function readText(cell: SpreadsheetCell | undefined): string | null {
  return cell?.text.trim() || null;
}

function readFirmwareRow(options: {
  row: SpreadsheetRow;
  columns: Columns;
  isDate1904: boolean;
}): FirmwareRow | undefined {
  const { row, columns, isDate1904 } = options;
  const read = (key: keyof typeof HEADERS): SpreadsheetCell | undefined => {
    const column = columns[key];
    return column === undefined ? undefined : row.get(column);
  };
  const model = readText(read('model'));
  const person = readText(read('person'));
  const models = readModels(model ?? '');
  if (!models.length || (model === HEADERS.model && person === HEADERS.person)) return undefined;
  return {
    models,
    person: person && !UNKNOWN_PERSON.test(person.normalize('NFKC')) ? person : null,
    archivedAt: readArchiveDate(read('archivedAt'), isDate1904),
    code: readText(read('code')),
    chip: readText(read('chip')),
    summary: readText(read('summary')),
  };
}

/**
 * 找到有效表头后逐条投影固件行，忽略空型号及重复出现的表头。
 * @param options 工作表 XML、共享字符串与日期系统。
 * @returns 已投影的有效固件行，保持原始顺序。
 * @throws AppError 工作表缺少型号或责任人表头，或 XML 无效。
 */
export function* readFirmwareRows(options: {
  xml: string;
  sharedStrings: readonly string[];
  isDate1904: boolean;
}): Generator<FirmwareRow, void> {
  // 1. 根据表头名称定位列。2. 对其余行仅使用各行实际出现的值。
  let columns: Columns | undefined;
  for (const row of readWorksheetRows(options)) {
    if (!columns) {
      columns = getColumns(row); // 1.
      continue;
    }
    const firmware = readFirmwareRow({ row, columns, isDate1904: options.isDate1904 }); // 2.
    if (firmware) yield firmware;
  }
  if (!columns) throw new AppError('structure', 'missing_codetable_headers', 'codetable');
}
