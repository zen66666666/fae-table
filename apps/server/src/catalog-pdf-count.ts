// 缓存资料目录的 PDF 计数并在后台更新，供连接状态快照立即读取。
import type { CatalogStatus } from '../../../packages/core/src/index.ts';
import { CATALOG_PDF_STATS_MS } from './constants.ts';
import type { ServerDependencies } from './types.ts';

type PdfCounts = Pick<CatalogStatus, 'pdfCount' | 'isPdfCountLimited' | 'pdfCountLimit'>;
type CountEntry = {
  folder: string;
  counts: PdfCounts;
  requestedAt?: number;
  isPending: boolean;
  hasRecountRequest: boolean;
};

const EMPTY_COUNTS: PdfCounts = { pdfCount: 0 };

/** 后台计数缓存；读取不等待扫描，同目录的例行更新遵循固定间隔。 */
export class CatalogPdfCount {
  private readonly options: Pick<ServerDependencies, 'now' | 'schedule'> & {
    signal: AbortSignal;
    scan: (folder: string) => Promise<CatalogStatus>;
  };
  private entry?: CountEntry;

  /**
   * 创建尚未统计任何目录的缓存。
   * @param options 有界扫描函数、调度和实例生命周期。
   * @throws 无预期错误。
   */
  constructor(options: CatalogPdfCount['options']) {
    this.options = options;
  }

  /**
   * 读取当前目录已有计数。
   * @param folder 当前目录；没有匹配统计时为空。
   * @returns 已有计数及有限扫描的标记。
   * @throws 无预期错误。
   */
  read(folder: string | null): PdfCounts {
    return this.entry?.folder === folder ? this.entry.counts : EMPTY_COUNTS;
  }

  /**
   * 按间隔安排计数，或在完整检查成功时主动更新一次。
   * @param options 已验证目录，以及是否来自完整检查。
   * @returns 已排队或复用现有任务。
   * @throws 无预期错误。
   */
  schedule(options: { folder: string; isForced: boolean }): void {
    // 1. 切换目录后拒绝迟到计数。2. 确认间隔后把扫描交给后台。
    const { folder, isForced } = options;
    if (this.options.signal.aborted) return;
    if (this.entry?.folder !== folder) {
      this.entry = { folder, counts: EMPTY_COUNTS, isPending: false, hasRecountRequest: false }; // 1.
    }
    const entry = this.entry;
    if (entry.isPending) {
      if (isForced) entry.hasRecountRequest = true;
      return;
    }
    const now = this.options.now();
    if (
      !isForced &&
      entry.requestedAt !== undefined &&
      now - entry.requestedAt < CATALOG_PDF_STATS_MS
    )
      return;
    entry.requestedAt = now;
    entry.isPending = true;
    this.options.schedule(() => void this.update(entry)); // 2.
  }

  private async update(entry: CountEntry): Promise<void> {
    try {
      if (this.entry !== entry || this.options.signal.aborted) return;
      const status = await this.options.scan(entry.folder);
      if (this.entry === entry && !this.options.signal.aborted && status.state === 'ready') {
        const { pdfCount, isPdfCountLimited, pdfCountLimit } = status;
        entry.counts = { pdfCount, isPdfCountLimited, pdfCountLimit };
      }
    } catch {
      // 计数失败沿用本目录的旧数量；目录可用性由轻检查单独确认。
    } finally {
      entry.isPending = false;
      if (entry.hasRecountRequest && this.entry === entry) {
        entry.hasRecountRequest = false;
        this.schedule({ folder: entry.folder, isForced: true });
      }
    }
  }
}
