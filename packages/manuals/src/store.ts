// 组合本机手册目录、持久化索引和按官网编号去重的下载队列，供后台使用。
import type { Readable } from 'node:stream';
import type {
  ManualLookupResult,
  ManualStoredStatus,
  TextFileSystem,
} from '../../core/src/index.ts';
import { MANUAL_REQUEST_CONCURRENCY } from './constants.ts';
import { assertManualStoreActive, ManualDownloadError } from './download-error.ts';
import type { ManualLookup } from './index.ts';
import { normalizeManualModel } from './model.ts';
import type { ManualRequestOptions } from './request.ts';
import { ManualStoreDirectory } from './store-directory.ts';
import { openSavedFile, openSavedManualStream, saveDownloadedManual } from './store-files.ts';
import type { ManualFileSystem } from './store-files.ts';
import { ManualStoreIndex, readManualMetadata, restoreManualLookup } from './store-index.ts';
import type { ManualStoredEntry, StoredManualMatch } from './store-index.ts';
import { getSavedTextSource } from './store-text-source.ts';
import { ManualTaskQueue } from './task-queue.ts';
import type { ManualTextSource } from './text-types.ts';

/** 持久化存储依赖；本机资料目录由后台解析，未替换的文件操作使用 Node 实现。 */
export type ManualStoreOptions = ManualRequestOptions & {
  lookup: ManualLookup;
  getDirectory: () => Promise<string>;
  dataDir: string;
  /** 允许创建开发或默认目录；企业用户选定路径须已存在。 */
  canCreateDirectory?: boolean;
  now?: () => number;
  fileSystem?: Partial<ManualFileSystem>;
  textFileSystem?: TextFileSystem;
};

type StoredLookup = Extract<ManualLookupResult, { kind: 'found' }>;
type OpenedManual = { fileName: string; size: number; stream: Readable };
type EnsureOptions = { isForced?: boolean };
type OpenTextOptions = { isDownloadAllowed?: boolean };
type SelectedManual = { query: string; match: StoredManualMatch };

/**
 * 本机手册能力，所有失败只传递安全分类。
 * @property getStoredLookup 恢复已核实官网结果，用于不访问官网的重启恢复。
 * @property getSaved 仅检查本地文件，不下载。
 * @property ensure 复用索引文件或下载对应的 PDF；强制时跳过已有文件。
 * @property open 打开经过校验的本地 PDF 流；调用者负责消费或销毁流。
 * @property openTextSource 提供已核实 PDF 的只读源；默认只读本地，明确允许时可下载。
 * @property prepareDirectory 核实实际目录，并将文件索引绑定到这个目录。
 * @property getDirectory 重新核实已绑定的资料目录；改指到另一目录时失败。
 * @property waitForIdle 等待正在处理的存储任务清理暂存文件。
 */
export type ManualStore = {
  getStoredLookup: (model: string) => Promise<StoredLookup | undefined>;
  getSaved: (model: string) => Promise<ManualStoredStatus | null>;
  ensure: (model: string, options?: EnsureOptions) => Promise<ManualStoredEntry>;
  open: (model: string) => Promise<OpenedManual>;
  openTextSource: (
    model: string,
    options?: OpenTextOptions,
  ) => Promise<ManualTextSource | undefined>;
  prepareDirectory: () => Promise<string>;
  getDirectory: () => Promise<string>;
  waitForIdle: () => Promise<void>;
};

class LocalManualStore {
  private readonly options: ManualStoreOptions;
  private readonly now: () => number;
  private readonly index: ManualStoreIndex;
  private readonly directory: ManualStoreDirectory;
  private readonly queue = new ManualTaskQueue<string, ManualStoredEntry>(
    MANUAL_REQUEST_CONCURRENCY,
  );
  private readonly operations = new Set<Promise<unknown>>();

  constructor(options: ManualStoreOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.index = new ManualStoreIndex({
      dataDir: options.dataDir,
      fileSystem: options.textFileSystem,
      signal: options.signal,
    });
    this.directory = new ManualStoreDirectory({ ...options, index: this.index });
  }

  prepareDirectory(): Promise<string> {
    return this.getDirectory();
  }

  getDirectory(): Promise<string> {
    return this.track(this.directory.verify());
  }

  async getStoredLookup(model: string): Promise<StoredLookup | undefined> {
    const query = normalizeManualModel(model);
    if (!query) return undefined;
    const match = this.index.getMatch(query);
    return match ? restoreManualLookup(query, match) : undefined;
  }

  private selectModel(model: string): SelectedManual | undefined {
    const query = normalizeManualModel(model);
    if (!query) return undefined;
    const live = this.options.lookup.peek(query);
    const match =
      (live?.kind === 'found' ? readManualMetadata(query, live.match) : undefined) ??
      this.index.getMatch(query);
    return match ? { query, match } : undefined;
  }

  private async checkFile(productId: string): Promise<ManualStoredEntry | undefined> {
    const directory = await this.getDirectory();
    while (true) {
      const entry = this.index.getFile(productId);
      if (!entry) return undefined;
      const handle = await openSavedFile({
        ...entry,
        directory,
        fileSystem: this.options.fileSystem,
      });
      await handle?.close().catch(() => {
        throw new ManualDownloadError('storage');
      });
      assertManualStoreActive(this.options.signal);
      // 校验期间也可能完成另一轮下载；旧校验不得删除新文件条目。
      if (this.index.getFile(productId) !== entry) continue;
      if (handle) return entry;
      this.index.invalidate(entry);
      return undefined;
    }
  }

  private async getSavedStatus(model: string): Promise<ManualStoredStatus | null> {
    assertManualStoreActive(this.options.signal);
    const selected = this.selectModel(model);
    if (!selected) return null;
    const current = await this.checkFile(selected.match.productId);
    return current ? { downloadedAt: current.downloadedAt } : null;
  }

  getSaved(model: string): Promise<ManualStoredStatus | null> {
    return this.track(this.getSavedStatus(model));
  }

  private async download(selected: SelectedManual): Promise<ManualStoredEntry> {
    const { productId, model } = selected.match;
    assertManualStoreActive(this.options.signal);
    const directory = await this.getDirectory();
    const date = new Date(this.now()).toISOString().slice(0, 10).replaceAll('-', '');
    const pdf = await saveDownloadedManual({
      ...this.options,
      directory,
      productId,
      model,
      date,
      verifyDirectory: async () => {
        await this.getDirectory();
      },
    });
    const entry = { ...pdf, productId, downloadedAt: new Date(this.now()).toISOString() };
    // 先得到已发布的完整文件再写索引；索引失败时保留文件以便下次按摘要复用。
    this.index.save({ ...selected, entry });
    return entry;
  }

  private async ensureFile(model: string, options: EnsureOptions): Promise<ManualStoredEntry> {
    // 1. 只接受已核实的型号。2. 复用同编号任务或有效文件。3. 保存各查询别名。
    assertManualStoreActive(this.options.signal);
    const selected = this.selectModel(model); // 1.
    if (!selected) throw new ManualDownloadError('not-found');
    const { productId } = selected.match;
    let pending = this.queue.getPending(productId); // 2.
    let saved: ManualStoredEntry | undefined;
    if (!pending && !options.isForced) {
      saved = await this.checkFile(productId);
      pending = this.queue.getPending(productId);
    }
    const entry = pending
      ? await pending
      : (saved ?? (await this.queue.enqueue(productId, () => this.download(selected))));
    assertManualStoreActive(this.options.signal);
    this.index.saveMatch(selected); // 3.
    return { ...entry };
  }

  ensure(model: string, options: EnsureOptions = {}): Promise<ManualStoredEntry> {
    return this.track(this.ensureFile(model, options));
  }

  private track<T>(result: Promise<T>): Promise<T> {
    this.operations.add(result);
    const finish = () => {
      this.operations.delete(result);
    };
    void result.then(finish, finish);
    return result;
  }

  private async openFile(model: string): Promise<OpenedManual> {
    // 文件可能在完成本地存在性检查后被移动，按通常规则再验证一次，缺失才下载。
    for (let attempt = 0; attempt < 2; attempt++) {
      const entry = await this.ensure(model);
      const directory = await this.getDirectory();
      const stream = await openSavedManualStream({
        ...entry,
        directory,
        fileSystem: this.options.fileSystem,
        signal: this.options.signal,
      });
      if (stream) return { fileName: entry.fileName, size: entry.size, stream };
    }
    throw new ManualDownloadError('storage');
  }

  open(model: string): Promise<OpenedManual> {
    return this.track(this.openFile(model));
  }

  private async findTextSource(
    model: string,
    options: OpenTextOptions,
  ): Promise<ManualTextSource | undefined> {
    // 1. 只接受已核实型号。2. 问答显式允许时走原有下载规则。3. 返回受控的只读本机源。
    assertManualStoreActive(this.options.signal);
    const selected = this.selectModel(model); // 1.
    if (!selected) return undefined;
    if (options.isDownloadAllowed) await this.ensure(model); // 2.
    return getSavedTextSource({
      // 3.
      productId: selected.match.productId,
      index: this.index,
      getDirectory: () => this.directory.resolveSource(),
      boundDirectory: this.directory.getBoundPath(),
      fileSystem: this.options.fileSystem,
      signal: this.options.signal,
    });
  }

  openTextSource(
    model: string,
    options: OpenTextOptions = {},
  ): Promise<ManualTextSource | undefined> {
    return this.track(this.findTextSource(model, options));
  }

  async waitForIdle(): Promise<void> {
    while (this.operations.size) await Promise.allSettled(this.operations);
  }
}

/**
 * 创建后台手册存储实例，使用已核实的官网结果并保留本机下载索引。
 * @param options 查询、文件和 HTTP 依赖以及运行数据目录。
 * @returns 提供索引状态、下载、目录和安全文件读取的本机存储。
 * @throws 创建时无预期错误，文件或网络错误由各操作报告。
 */
export function createManualStore(options: ManualStoreOptions): ManualStore {
  const store = new LocalManualStore(options);
  return {
    getStoredLookup: (model) => store.getStoredLookup(model),
    getSaved: (model) => store.getSaved(model),
    ensure: (model, ensureOptions) => store.ensure(model, ensureOptions),
    open: (model) => store.open(model),
    openTextSource: (model, textOptions) => store.openTextSource(model, textOptions),
    prepareDirectory: () => store.prepareDirectory(),
    getDirectory: () => store.getDirectory(),
    waitForIdle: () => store.waitForIdle(),
  };
}
