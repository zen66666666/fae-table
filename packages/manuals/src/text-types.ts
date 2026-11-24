// 定义后台手册文本读取与检索接口，由手册存储、检索和 PDF 线程共用。
import type { Readable } from 'node:stream';

/** 已核实的本机 PDF 元数据及只读流；调用方负责消费或销毁返回的流。 */
export type ManualTextSource = {
  fileName: string;
  sha256: string;
  size: number;
  open: () => Promise<Readable | undefined>;
};

/** 单份手册的处理结果；仅包含本机文件名、固定状态和页数。 */
export type ManualTextFileResult = {
  fileName: string;
  kind: 'ready' | 'no-text' | 'invalid' | 'timeout' | 'unavailable' | 'too-large';
  pageCount?: number;
  charCount?: number;
  isTruncated?: boolean;
};

/** 提供给后台的命中文本片段，页号为 PDF 实际页序号，自 1 开始。 */
export type ManualTextSnippet = { fileName: string; page: number; text: string };

/** 一次检索的引文和处理过的本机手册列表。 */
export type ManualTextSearchResult = {
  snippets: ManualTextSnippet[];
  files: ManualTextFileResult[];
};

/** 内部解析结果，正文仅保留在本机进程内存中。 */
export type ParsedManualText = Omit<ManualTextFileResult, 'fileName'> & {
  pages?: { page: number; text: string }[];
};
