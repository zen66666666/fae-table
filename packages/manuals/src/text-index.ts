// 管理按文件摘要缓存的本机手册文本，供后台预热与当前问答检索。
import { readVerifiedPdf } from './read-pdf-input.ts';
import { parseVerifiedPdf } from './read-pdf-text.ts';
import { ManualTaskQueue } from './task-queue.ts';
import {
  MANUAL_SEARCH_FILE_LIMIT,
  MANUAL_TEXT_CACHE_CHAR_LIMIT,
  MANUAL_TEXT_CACHE_FILE_LIMIT,
  MANUAL_TEXT_CONCURRENCY,
  MANUAL_TEXT_QUEUE_LIMIT,
  PDF_TEXT_TIMEOUT_MS,
} from './text-limits.ts';
import { selectManualSnippets } from './text-search.ts';
import type {
  ManualTextFileResult,
  ManualTextSearchResult,
  ManualTextSource,
  ParsedManualText,
} from './text-types.ts';

type ExtractOptions = { source: ManualTextSource; signal?: AbortSignal };
type SearchOptions = {
  question: string;
  sources: readonly ManualTextSource[];
  signal?: AbortSignal;
};
type CacheEntry = { parsed: ParsedManualText; chars: number };

/** 工作台实例的有界 PDF 文本索引；只在进程内存中缓存按摘要提取的文字。 */
export type ManualTextIndex = {
  /**
   * 预热一份本机手册或检查扫描件状态。
   * @param options 已核实源与可选取消信号。
   * @returns 固定的读取状态，不包含手册正文。
   * @throws 无预期错误。
   */
  extract: (options: ExtractOptions) => Promise<ManualTextFileResult>;
  /**
   * 在限定的本机手册中检索与用户问题有关的文本。
   * @param options 当前问题、已核实的本机手册和可选取消信号。
   * @returns 带页号的引文与文件状态，失败不包含路径或解析器错误。
   * @throws 无预期错误。
   */
  search: (options: SearchOptions) => Promise<ManualTextSearchResult>;
};

/** 文本工作线程和截止时间的可替换依赖，默认使用 Node 实现。 */
export type ManualTextIndexOptions = {
  parse?: typeof parseVerifiedPdf;
  createDeadline?: (timeoutMs: number) => AbortSignal;
};

function getFileResult(fileName: string, parsed: ParsedManualText): ManualTextFileResult {
  const { kind, pageCount, charCount, isTruncated } = parsed;
  return { fileName, kind, pageCount, charCount, isTruncated };
}

class LocalManualTextIndex {
  private readonly queue = new ManualTaskQueue<symbol, ParsedManualText>(MANUAL_TEXT_CONCURRENCY);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly parsing = new Map<string, Promise<ParsedManualText>>();
  private readonly parse: typeof parseVerifiedPdf;
  private readonly createDeadline: (timeoutMs: number) => AbortSignal;
  private pendingCount = 0;
  private cachedChars = 0;

  constructor(options: ManualTextIndexOptions) {
    this.parse = options.parse ?? parseVerifiedPdf;
    this.createDeadline = options.createDeadline ?? AbortSignal.timeout;
  }

  private getCached(sha256: string): ParsedManualText | undefined {
    const entry = this.cache.get(sha256);
    if (!entry) return undefined;
    this.cache.delete(sha256);
    this.cache.set(sha256, entry);
    return entry.parsed;
  }

  private setCached(sha256: string, parsed: ParsedManualText): void {
    const before = this.cache.get(sha256);
    if (before) this.cachedChars -= before.chars;
    this.cache.delete(sha256);
    const chars = parsed.charCount ?? 0;
    this.cache.set(sha256, { parsed, chars });
    this.cachedChars += chars;
    while (
      this.cache.size > MANUAL_TEXT_CACHE_FILE_LIMIT ||
      this.cachedChars > MANUAL_TEXT_CACHE_CHAR_LIMIT
    ) {
      const oldest = this.cache.entries().next();
      if (oldest.done) break;
      const [key, removed] = oldest.value;
      this.cachedChars -= removed.chars;
      this.cache.delete(key);
    }
  }

  private async parseOnce(options: {
    sha256: string;
    bytes: Uint8Array;
    signal: AbortSignal;
  }): Promise<ParsedManualText> {
    const { sha256, bytes, signal } = options;
    const cached = this.getCached(sha256);
    if (cached) return cached;
    // 各请求独立核实文件，摘要相同的 PDF 则共享正在进行的解析。
    const parsing = this.parsing.get(sha256);
    if (parsing) return parsing;
    const result = this.parse({ bytes, signal });
    this.parsing.set(sha256, result);
    try {
      const parsed = await result;
      // 同一摘要的扫描件或确定的格式错误不会再次启动解析。
      if (
        !signal.aborted &&
        (parsed.kind === 'ready' || parsed.kind === 'no-text' || parsed.kind === 'invalid')
      )
        this.setCached(sha256, parsed);
      return parsed;
    } finally {
      this.parsing.delete(sha256);
    }
  }

  private async read(options: ExtractOptions): Promise<ParsedManualText> {
    // 1. 创建任务共同超时。2. 核实字节后读取缓存或提取。3. 确认任务仍有效。
    if (options.signal?.aborted) return { kind: 'unavailable' };
    const timeout = this.createDeadline(PDF_TEXT_TIMEOUT_MS); // 1.
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const cached = this.getCached(options.source.sha256);
    const input = await readVerifiedPdf({
      source: options.source,
      signal,
      hasCachedText: !!cached,
    }); // 2.
    if (timeout.aborted) return { kind: 'timeout' };
    if (signal.aborted) return { kind: 'unavailable' };
    if (input.kind !== 'verified') return input;
    if (cached) return cached;
    if (!input.bytes) return { kind: 'invalid' };
    const parsed = await this.parseOnce({
      sha256: options.source.sha256,
      bytes: input.bytes,
      signal,
    });
    // 3. 过期任务不得使用该文本。
    if (timeout.aborted) return { kind: 'timeout' };
    if (signal.aborted) return { kind: 'unavailable' };
    return parsed;
  }

  private async schedule(options: ExtractOptions): Promise<ParsedManualText> {
    if (this.pendingCount >= MANUAL_TEXT_QUEUE_LIMIT || options.signal?.aborted)
      return { kind: 'unavailable' };
    this.pendingCount++;
    try {
      // 每个源都复核自己的受控句柄，不能以另一个同 SHA 源存在来证明当前文件仍然可读。
      return await this.queue.enqueue(Symbol(), () => this.read(options));
    } catch {
      return { kind: 'unavailable' };
    } finally {
      this.pendingCount--;
    }
  }

  async extract(options: ExtractOptions): Promise<ManualTextFileResult> {
    return getFileResult(options.source.fileName, await this.schedule(options));
  }

  async search(options: SearchOptions): Promise<ManualTextSearchResult> {
    // 1. 提取受限候选文件。2. 用同一个相关性规则排序可读文档片段。
    const results = await Promise.all(
      // 1.
      options.sources.slice(0, MANUAL_SEARCH_FILE_LIMIT).map(async (source) => ({
        fileName: source.fileName,
        parsed: await this.schedule({ source, signal: options.signal }),
      })),
    );
    const files = results.map(({ fileName, parsed }) => getFileResult(fileName, parsed));
    const documents = results.flatMap(({ fileName, parsed }) =>
      parsed.pages?.length ? [{ fileName, pages: parsed.pages }] : [],
    );
    const snippets = options.signal?.aborted
      ? []
      : selectManualSnippets({ question: options.question, documents }); // 2.
    return { files, snippets };
  }
}

/**
 * 创建本机手册提取与检索索引，供后台实例复用。
 * @param options 可替换的解析器和截止时间来源。
 * @returns 有界的提取和搜索接口；不会持久化正文。
 * @throws 无预期错误。
 */
export function createManualTextIndex(options: ManualTextIndexOptions = {}): ManualTextIndex {
  return new LocalManualTextIndex(options);
}
