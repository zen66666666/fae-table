// 跟踪待处理手册预下载及其重试，供手册服务在目录和单据变化时调用。
import {
  getRetryDelay,
  getTicketProductModels,
  isTicketFinished,
} from '../../../packages/core/src/index.ts';
import type { ManualLookupResult, TicketListItem } from '../../../packages/core/src/index.ts';
import { ManualDownloadError } from '../../../packages/manuals/src/index.ts';
import type { ManualStore } from '../../../packages/manuals/src/index.ts';
import { TICKET_REFRESH_MS } from './constants.ts';
import type { ManualStorage } from './manual-storage.ts';
import type { TicketService } from './ticket-service.ts';
import type { ConnectionContext } from './types.ts';

type PrefetchJob = {
  store: ManualStore;
  failureCount: number;
  timer?: ReturnType<typeof setTimeout>;
};

type PrefetchOptions = Pick<ConnectionContext, 'dependencies' | 'signal'> &
  Pick<TicketService, 'peekTicketFields'> & {
    storage: ManualStorage;
    getOrLookup: (model: string, store: ManualStore) => Promise<ManualLookupResult>;
  };

/** 为一个本机手册服务合并预下载，并只对暂时性失败退避重试。 */
export class ManualPrefetch {
  private readonly options: PrefetchOptions;
  private items: readonly TicketListItem[] = [];
  private readonly jobs = new Map<string, PrefetchJob>();

  /**
   * 创建预下载调度器，退出时取消等待中的重试。
   * @param options 当前存储、匹配读取和可替换时钟。
   * @throws 无预期错误。
   */
  constructor(options: PrefetchOptions) {
    this.options = options;
    options.signal.addEventListener('abort', () => this.setItems([]), { once: true });
  }

  /**
   * 判断这个型号是否有尚未完成的预下载。
   * @param model 当前单据的规范化查询型号。
   * @returns 有活动或等待重试的任务时为 true。
   * @throws 无预期错误。
   */
  hasPending(model: string): boolean {
    return this.jobs.has(model);
  }

  /**
   * 按本轮有资格的单据更新下载任务。相同产品编号的实际下载由手册模块合并。
   * @param items 当前最近单据，预下载只使用待确认收到和未回复项；身份失效时传空列表。
   * @returns 无返回值，下载在后台进行。
   * @throws 无预期错误。
   */
  setItems(items: readonly TicketListItem[]): void {
    this.items = items;
    this.reconcile();
  }

  /**
   * 存储切换时重排任务，取消旧范围的等待。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  reconcile(): void {
    // 1. 停止对已离开范围的型号安排新请求。2. 启动尚未安排的型号。
    const store = this.options.storage.active;
    const next = store ? this.getPrefetchModels(this.items) : new Set<string>();
    const { dependencies, signal } = this.options;
    for (const [model, job] of this.jobs) {
      if (next.has(model) && !signal.aborted) continue;
      if (job.timer !== undefined) dependencies.clearTimer(job.timer); // 1.
      this.jobs.delete(model);
    }
    if (!store || signal.aborted) return;
    for (const model of next) {
      if (this.jobs.has(model)) continue;
      const job = { store, failureCount: 0 };
      this.jobs.set(model, job); // 2.
      void this.runPrefetch(model, job);
    }
  }

  private getPrefetchModels(items: readonly TicketListItem[]): Set<string> {
    const models = new Set<string>();
    for (const item of items) {
      if (item.replyStatus !== 'awaiting-receipt' && item.replyStatus !== 'unreplied') continue;
      // 判断实际回复进度，包含移交给我的单据；终态仍须等用户打开后下载。
      if (isTicketFinished(item)) continue;
      const fields = this.options.peekTicketFields(item.id);
      if (typeof fields !== 'string')
        for (const model of getTicketProductModels(fields)) models.add(model);
    }
    return models;
  }

  private async runPrefetch(model: string, job: PrefetchJob): Promise<void> {
    // 1. 等手册匹配。2. 共用本机索引或下载。3. 只对暂时性错误安排下一次。
    const { dependencies, signal } = this.options;
    let retryDelay: number | undefined;
    try {
      const result = await this.options.getOrLookup(model, job.store); // 1.
      if (this.jobs.get(model) !== job || signal.aborted) return;
      if (result.kind === 'found')
        await this.options.storage.observeWrite(job.store, () => job.store.ensure(model)); // 2.
      if (result.kind === 'unavailable' && result.retryAt !== undefined) {
        retryDelay = Math.max(0, result.retryAt - dependencies.now());
      }
    } catch (error) {
      if (error instanceof ManualDownloadError && error.isRetryable) {
        job.failureCount++;
        retryDelay = getRetryDelay({
          failureCount: job.failureCount,
          maxDelayMs: TICKET_REFRESH_MS,
        });
      }
    } finally {
      if (this.jobs.get(model) === job && !signal.aborted) {
        if (retryDelay === undefined) this.jobs.delete(model);
        else {
          job.timer = dependencies.setTimer(() => {
            job.timer = undefined;
            void this.runPrefetch(model, job); // 3.
          }, retryDelay);
        }
      }
    }
  }
}
