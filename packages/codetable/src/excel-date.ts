// 将码表归档列的 Excel 序号或日期文本转换为稳定的日历日期。
import type { SpreadsheetCell } from './worksheet.ts';

const DAY_MS = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 31);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
const LEAP_BUG_SERIAL = 60;
const EXCEL_NUMBER = /^\+?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu;
const TEXT_DATE =
  /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日|(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?))?$/u;

function formatCalendarDate(date: Date): string | null {
  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999 ? date.toISOString().slice(0, 10) : null;
}

function formatExcelSerial(text: string, isDate1904: boolean): string | null {
  const days = Math.floor(Number(text));
  if (!Number.isSafeInteger(days) || days < 0) return null;
  // Excel 的 1900 日期系统包含不存在的闰日；序号 60 与前一实际日归在同一天。
  const leapCorrection = !isDate1904 && days >= LEAP_BUG_SERIAL ? 1 : 0;
  const epoch = isDate1904 ? EPOCH_1904 : EPOCH_1900;
  return formatCalendarDate(new Date(epoch + (days - leapCorrection) * DAY_MS));
}

function formatDateText(text: string): string | null {
  const parts = TEXT_DATE.exec(text);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return formatCalendarDate(date);
}

/**
 * 读取 Excel 归档日期，保留工作簿内的日历日，不受当前系统时区影响。
 * @param cell 已投影的归档日期单元格，可为空。
 * @param isDate1904 工作簿是否使用 1904 日期系统。
 * @returns YYYY-MM-DD 日期；空值或无效日期返回 null。
 * @throws 无预期错误。
 */
export function readArchiveDate(
  cell: SpreadsheetCell | undefined,
  isDate1904: boolean,
): string | null {
  if (!cell) return null;
  const text = cell.text.trim().normalize('NFKC');
  if (!text) return null;
  return cell.isNumber && EXCEL_NUMBER.test(text)
    ? formatExcelSerial(text, isDate1904)
    : formatDateText(text);
}
