// 串行切换手册目录与索引，供单据手册服务协调下载和文件夹保存。
import type { CatalogWriteFailureReason } from '../../../packages/core/src/index.ts';
import { createManualStore, ManualDownloadError } from '../../../packages/manuals/src/index.ts';
import type { ManualLookup, ManualStore } from '../../../packages/manuals/src/index.ts';
import type { ConnectionContext } from './types.ts';

type DirectoryTask = {
  directory: string | undefined;
  controller: AbortController;
  ready?: Promise<ManualStore | undefined>;
  store?: ManualStore;
  active?: ManualStore;
  isFailed: boolean;
};

type ManualStorageOptions = {
  context: ConnectionContext;
  lookup: ManualLookup;
  onWriteFailure: (reason: CatalogWriteFailureReason) => void;
};

/** 后台当前有效的手册存储范围；过渡期间暂停新的 PDF 操作。 */
export class ManualStorage {
  private readonly context: ConnectionContext;
  private readonly lookup: ManualLookup;
  private readonly onWriteFailure: ManualStorageOptions['onWriteFailure'];
  private target?: DirectoryTask;

  /**
   * 创建尚未绑定资料目录的手册存储协调器。
   * @param options 本机运行环境、官网查询及所选资料位置写入失败通知。
   * @throws 无预期错误。
   */
  constructor(options: ManualStorageOptions) {
    this.context = options.context;
    this.lookup = options.lookup;
    this.onWriteFailure = options.onWriteFailure;
  }

  /** 完成目录验证和索引切换的当前存储；未设置或切换中为 undefined。 */
  get active(): ManualStore | undefined {
    return this.context.signal.aborted ? undefined : this.target?.active;
  }

  /**
   * 执行可能写入手册的操作，并上报仍属当前资料目录的权限或空间失败。
   * @param store 启动操作时的存储范围。
   * @param perform 可能写入 PDF 的异步操作。
   * @returns 操作结果。
   * @throws 保留操作原有的安全错误。
   */
  async observeWrite<Result>(store: ManualStore, perform: () => Promise<Result>): Promise<Result> {
    try {
      return await perform();
    } catch (error) {
      // 已失效的任务或开发覆盖目录不能改变已保存资料目录的状态。
      if (
        store === this.active &&
        this.context.manualsDirectory === undefined &&
        error instanceof ManualDownloadError &&
        error.writeFailure
      ) {
        this.onWriteFailure(error.writeFailure);
      }
      throw error;
    }
  }

  /**
   * 选择已核实的资料目录，后台显式覆盖目录优先。
   * @param folder 用户配置中当前可用的路径，未设置或已不可用时省略。
   * @returns 目录改变时返回本次切换；有效目标相同则复用尚未完成的切换。
   * @throws 创建或核验索引失败时由 Promise 安全报告。
   */
  configure(folder?: string): { hasChanged: boolean; ready: Promise<ManualStore | undefined> } {
    const directory = this.context.manualsDirectory ?? folder;
    const previous = this.target;
    if (this.context.signal.aborted)
      return { hasChanged: false, ready: Promise.resolve(undefined) };
    if (previous?.directory === directory && !previous?.isFailed)
      return { hasChanged: false, ready: previous?.ready ?? Promise.resolve(undefined) };
    // 换目录时立即关闭旧入口，以免旧索引或下载结果在新配置下仍可见。
    previous?.controller.abort();
    const task: DirectoryTask = { directory, controller: new AbortController(), isFailed: false };
    this.target = task;
    const ready = this.activate({ task, previous });
    task.ready = ready;
    return { hasChanged: true, ready };
  }

  private async activate(options: {
    task: DirectoryTask;
    previous?: DirectoryTask;
  }): Promise<ManualStore | undefined> {
    // 1. 等待旧存储取消并清理。2. 核实新目录并原子绑定索引。3. 才允许新操作。
    const { task, previous } = options;
    await previous?.ready?.catch(() => undefined); // 1.
    await previous?.store?.waitForIdle();
    const directory = task.directory;
    const signal = AbortSignal.any([task.controller.signal, this.context.signal]);
    if (!directory || signal.aborted) return undefined;
    const { dependencies, dataDir, manualsDirectory } = this.context;
    const store = createManualStore({
      dataDir,
      lookup: this.lookup,
      fetch: dependencies.fetch,
      now: dependencies.now,
      fileSystem: dependencies.manualFileSystem,
      signal,
      getDirectory: async () => directory,
      // 客户选择的目录一旦消失，须由设置页确认后才创建；开发覆盖可自行准备。
      canCreateDirectory: manualsDirectory !== undefined,
    });
    task.store = store;
    try {
      await store.prepareDirectory(); // 2.
      if (!signal.aborted) task.active = store; // 3.
      return task.active;
    } catch (error) {
      if (signal.aborted) return undefined;
      task.isFailed = true;
      throw error;
    }
  }

  /**
   * 等待目录切换及剩余文件操作完成，退出时调用。
   * @returns 终止信号之后的清理完成。
   * @throws 无预期错误；单项失败由原调用者接收。
   */
  async waitForIdle(): Promise<void> {
    await this.target?.ready?.catch(() => undefined);
    await this.target?.store?.waitForIdle();
  }
}
