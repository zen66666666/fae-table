// 码表模块总览：通过系统 tar 读取本机工作簿，按型号构建只驻留内存的固件责任人索引。
// 后台负责上传文件的生命周期，仅通过 createCodeTableIndex 加载和查询码表。
import { createArchiveReader } from './archive.ts';
import type { CodeTableArchiveOptions } from './archive.ts';
import { readFirmwareRows } from './firmware-rows.ts';
import { CodeTableIndexBuilder } from './lookup.ts';
import type { CodeTableIndex } from './lookup.ts';
import { readSharedStrings } from './spreadsheet-text.ts';
import { readWorkbookParts } from './workbook.ts';

const WORKBOOK_PART = 'xl/workbook.xml';
const RELATIONSHIPS_PART = 'xl/_rels/workbook.xml.rels';
const DEFAULT_SHARED_STRINGS_PART = 'xl/sharedStrings.xml';
const METADATA_OUTPUT_BYTES = 2 * 1024 * 1024;
const DATA_OUTPUT_BYTES = 24 * 1024 * 1024;

/** 码表加载的本机文件和有界进程依赖。 */
export type CodeTableIndexOptions = CodeTableArchiveOptions;
/** 码表解析成功后的内存统计和查询契约。 */
export type { CodeTableIndex } from './lookup.ts';

/**
 * 加载指定工作簿的目标页并生成责任人索引，不生成解压文件。
 * @param options 暂存工作簿的绝对路径及可替换的进程环境。
 * @returns 含型号和去重责任人统计及型号匹配方法的索引。
 * @throws AppError ZIP、XML 或工作表结构无效、执行超时或系统 tar 不可用。
 */
export async function createCodeTableIndex(
  options: CodeTableIndexOptions,
): Promise<CodeTableIndex> {
  // 1. 读取工作簿元数据。2. 读取可选共享字符串。3. 逐页归并并发布完整内存索引。
  const read = createArchiveReader(options);
  const [workbook, relationships] = await Promise.allSettled([
    read({ member: WORKBOOK_PART, maxOutputBytes: METADATA_OUTPUT_BYTES }), // 1.
    read({ member: RELATIONSHIPS_PART, maxOutputBytes: METADATA_OUTPUT_BYTES }),
  ]);
  // 等两个进程结束后再报告失败，确保 Windows 上的上传临时文件可以立即删除。
  if (workbook.status === 'rejected') throw workbook.reason;
  if (relationships.status === 'rejected') throw relationships.reason;
  const parts = readWorkbookParts({
    workbook: workbook.value ?? '',
    relationships: relationships.value ?? '',
  });
  // 2. Excel 可使用内联字符串而没有共享表；显式存在关系时则必须读到该部件。
  const stringsXml = await read({
    member: parts.sharedStrings ?? DEFAULT_SHARED_STRINGS_PART,
    maxOutputBytes: DATA_OUTPUT_BYTES,
    isOptional: !parts.sharedStrings,
  });
  const sharedStrings = stringsXml ? readSharedStrings(stringsXml) : [];
  const builder = new CodeTableIndexBuilder();
  for (const member of parts.worksheets) {
    const xml = (await read({ member, maxOutputBytes: DATA_OUTPUT_BYTES })) ?? ''; // 3.
    builder.append(readFirmwareRows({ xml, sharedStrings, isDate1904: parts.isDate1904 }));
  }
  return builder.build();
}
