// 资料模块总览：为后台提供官网型号查找、本机 PDF 存储和本机文本检索。
// 官网请求只发经过校验的型号或编号，查找与下载均限流、去重。
import type { ManualLookupResult } from '../../core/src/index.ts';
import {
  MANUAL_CACHE_TTL_MS,
  MANUAL_FAILURE_TTL_MS,
  MANUAL_REQUEST_CONCURRENCY,
} from './constants.ts';
import { normalizeManualModel } from './model.ts';
import { requestManual } from './request.ts';
import type { ManualRequestOptions } from './request.ts';
import { ManualTaskQueue } from './task-queue.ts';

/** createManualStore 为后台建立本地资料下载、索引与安全读取。 */
export { createManualStore } from './store.ts';
/** 本地资料存储契约、依赖与已验证条目。 */
export type { ManualStore, ManualStoreOptions } from './store.ts';
export type { ManualStoredEntry } from './store-index.ts';
/** ManualDownloadError 仅携带安全失败类别、重试标记及可选的资料目录写入原因。 */
export { ManualDownloadError } from './download-error.ts';
/** 本机手册的安全下载失败类别。 */
export type { ManualDownloadReason } from './download-error.ts';
/** createManualTextIndex 创建后台使用的本机文本提取与检索索引。 */
export { createManualTextIndex } from './text-index.ts';
/** 本机文本索引能力与可替换依赖。 */
export type { ManualTextIndex, ManualTextIndexOptions } from './text-index.ts';
/** 本机可读文本源、提取状态和供后台引用的页号片段。 */
export type {
  ManualTextFileResult,
  ManualTextSearchResult,
  ManualTextSnippet,
  ManualTextSource,
} from './text-types.ts';

const INVALID_MODEL: ManualLookupResult = { kind: 'invalid-model', searchUrl: null };

/** 资料查询的可替换网络实现、时间来源和实例停止信号。 */
export type ManualLookupOptions = ManualRequestOptions & { now?: () => number };

/**
 * 一个后台实例共用的资料查询。
 * @property peek 只读有效缓存；非法型号立即返回，其它未缓存值为 undefined。
 * @property lookup 使用有效缓存或排队发起查询；显式更新只跳过暂时失败缓存。
 */
export type ManualLookup = {
  peek: (model: string) => ManualLookupResult | undefined;
  lookup: (model: string, options?: { isForced?: boolean }) => Promise<ManualLookupResult>;
};

type Entry = { result: ManualLookupResult; expiresAt: number };
function copyResult(result: ManualLookupResult): ManualLookupResult {
  return result.kind === 'found' ? { ...result, match: { ...result.match } } : { ...result };
}

class ManualLookupQueue {
  private readonly options: ManualLookupOptions;
  private readonly now: () => number;
  private readonly cache = new Map<string, Entry>();
  private readonly queue = new ManualTaskQueue<string, ManualLookupResult>(
    MANUAL_REQUEST_CONCURRENCY,
  );

  constructor(options: ManualLookupOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  peek(value: string): ManualLookupResult | undefined {
    const model = normalizeManualModel(value);
    if (!model) return copyResult(INVALID_MODEL);
    return this.readCache(model);
  }

  lookup(value: string, options: { isForced?: boolean } = {}): Promise<ManualLookupResult> {
    // 1. 校验并读取缓存。2. 相同型号复用在途请求。3. 未找到缓存或在途任务时安排队列。
    const model = normalizeManualModel(value); // 1.
    if (!model) return Promise.resolve(copyResult(INVALID_MODEL));
    const cached = this.readCache(model);
    if (cached && !(cached.kind === 'unavailable' && options.isForced))
      return Promise.resolve(cached);
    const pending = this.queue.getPending(model); // 2.
    if (pending) return pending;
    // 手动重试进行时移除旧失败，网页轮询能继续看到进行中状态。
    if (cached?.kind === 'unavailable') this.cache.delete(model);
    return this.queue.enqueue(model, async () => {
      // 3.
      const result = await requestManual({ ...this.options, model });
      return this.cacheResult({ model, result });
    });
  }

  private readCache(model: string): ManualLookupResult | undefined {
    const entry = this.cache.get(model);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.cache.delete(model);
      return undefined;
    }
    return copyResult(entry.result);
  }

  private cacheResult(options: { model: string; result: ManualLookupResult }): ManualLookupResult {
    const now = this.now();
    // 失败和成功的有效期不同，不能靠插入顺序判断剩余条目是否过期。
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
    const { model, result } = options;
    const expiresAt =
      now + (result.kind === 'unavailable' ? MANUAL_FAILURE_TTL_MS : MANUAL_CACHE_TTL_MS);
    const cached = result.kind === 'unavailable' ? { ...result, retryAt: expiresAt } : result;
    this.cache.set(model, { result: copyResult(cached), expiresAt });
    return cached;
  }
}

/**
 * 创建后台实例共用的官网资料查询及内存队列。
 * @param options 可替换网络、时钟和停止信号。
 * @returns 缓存检查和异步查询方法，不持久化输入或结果。
 * @throws 创建时无预期错误；依赖异常由查询调用方处理。
 */
export function createManualLookup(options: ManualLookupOptions = {}): ManualLookup {
  const queue = new ManualLookupQueue(options);
  return {
    peek: (model) => queue.peek(model),
    lookup: (model, options) => queue.lookup(model, options),
  };
}
