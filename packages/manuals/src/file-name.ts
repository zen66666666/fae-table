// 解析并核验手册文件名，供下载发布和持久化索引使用。
import path from 'node:path';
import { ManualDownloadError } from './download-error.ts';

const PDF_EXTENSION = '.pdf';
const FILE_NAME_LIMIT = 160;
const FALLBACK_NAME_SUFFIX = '_用户手册';
const INVALID_FILE_CHARACTER = /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/u;
const INVALID_FILE_CHARACTERS = /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/gu;
const RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/iu;
const DISPOSITION_NAME = /(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/iu;
const DISPOSITION_EXTENDED_NAME = /(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/iu;
const EXTENDED_VALUE = /^utf-8'[^']*'(.*)$/iu;

function isReservedName(name: string): boolean {
  return RESERVED_NAME.test(name.split('.')[0].trimEnd());
}

function removeTrailingDots(name: string): string {
  return name.replace(/[. ]+$/u, '');
}

function fitName(stem: string, suffix = ''): string {
  const limit = FILE_NAME_LIMIT - suffix.length - PDF_EXTENSION.length;
  const base = removeTrailingDots(stem.slice(0, limit).replace(/[\uD800-\uDBFF]$/u, ''));
  return `${base}${suffix}${PDF_EXTENSION}`;
}

function decodeName(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function readDispositionName(value: string): string | undefined {
  const extended = DISPOSITION_EXTENDED_NAME.exec(value);
  const encoded = extended && EXTENDED_VALUE.exec((extended[1] ?? extended[2]).trim())?.[1];
  if (encoded) {
    const name = decodeName(encoded);
    if (name) return name;
  }
  const plain = DISPOSITION_NAME.exec(value);
  return plain ? decodeName((plain[1] ?? plain[2]).trim()) : undefined;
}

function sanitizeName(value: string): string {
  return removeTrailingDots(value.replace(INVALID_FILE_CHARACTERS, '').trim());
}

function getSafeNameStem(value: string): string {
  const source = value.trim();
  const segments = source.split(/[\\/]/u);
  // 允许提取普通附加目录后的文件名，拒绝任何绝对路径或上级目录分量。
  if (
    path.win32.isAbsolute(source) ||
    /^[a-z]:/iu.test(source) ||
    segments.some((part) => part.replace(INVALID_FILE_CHARACTERS, '').trim() === '..')
  ) {
    throw new ManualDownloadError('invalid-filename');
  }
  const filename = sanitizeName(segments.at(-1) ?? '');
  if (isReservedName(filename)) throw new ManualDownloadError('invalid-filename');
  return removeTrailingDots(filename.replace(/\.pdf$/iu, ''));
}

/**
 * 从响应头获取安全的 PDF 文件名，普通缺失或空名称使用型号回退。
 * @param options Content-Disposition 与已校验的产品型号。
 * @returns 可在本机资料目录使用的单一 PDF 文件名。
 * @throws ManualDownloadError 发现路径穿越或系统保留名。
 */
export function getDownloadFileName(options: {
  disposition: string | null;
  model: string;
}): string {
  const name = readDispositionName(options.disposition ?? '');
  const stem = name ? getSafeNameStem(name) : '';
  const fallback = `${sanitizeName(options.model)}${FALLBACK_NAME_SUFFIX}`;
  return fitName(stem || (isReservedName(fallback) ? `_${fallback}` : fallback));
}

/**
 * 检查索引记录是否已经是安全的最终文件名，无需再次解码或转换。
 * @param value 索引内用于相对寻址的值。
 * @returns 允许拼接到已确认资料目录时为 true。
 * @throws 无预期错误。
 */
export function isSavedFileName(value: string): boolean {
  const stem = value.endsWith(PDF_EXTENSION) ? value.slice(0, -PDF_EXTENSION.length) : '';
  return (
    Boolean(stem) &&
    value.length <= FILE_NAME_LIMIT &&
    stem === removeTrailingDots(stem.trim()) &&
    !INVALID_FILE_CHARACTER.test(value) &&
    !isReservedName(stem)
  );
}

/**
 * 为内容不同的同名 PDF 生成变体名称，保留同一长度和扩展名限制。
 * @param options 基础文件名、已核实编号、UTC 日期及冲突序号。
 * @returns 新候选名，文件系统负责无覆盖发布。
 * @throws 无预期错误。
 */
export function getCollisionFileName(options: {
  fileName: string;
  productId: string;
  date: string;
  attempt: number;
}): string {
  const { fileName, productId, date, attempt } = options;
  const stem = fileName.slice(0, -PDF_EXTENSION.length);
  return fitName(stem, `_${productId}_${date}${attempt === 1 ? '' : `_${attempt}`}`);
}
