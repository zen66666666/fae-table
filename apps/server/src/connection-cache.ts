// 独立缓存钉钉和资料目录的检查结果，避免一项慢检查阻塞其他卡片。
import type { ConnectionStatus } from '../../../packages/core/src/index.ts';
import { STATUS_CACHE_MS } from './constants.ts';

/** 单项缓存依赖；检查延迟调度，时间和调度器可由调用方替换。 */
export type ConnectionCacheOptions<Status extends ConnectionStatus> = {
  initial: Status;
  check: () => Status | Promise<Status>;
  now: () => number;
  schedule: (callback: () => void) => void;
  signal: AbortSignal;
  cacheDurationMs?: number;
  onChange?: (status: Status) => void;
};

/** 单项连接缓存；每轮使用独立版本，旧检查不能覆盖新配置的状态。 */
export class ConnectionCache<Status extends ConnectionStatus> {
  private options: ConnectionCacheOptions<Status>;
  private current: Status;
  private checkedAt: number | undefined;
  private revision = 0;
  private pending: { revision: number; promise: Promise<Status> } | undefined;

  /**
   * 创建单项缓存。
   * @param options 初始状态和可替换检查环境。
   * @throws 不抛出预期错误。
   */
  constructor(options: ConnectionCacheOptions<Status>) {
    this.options = options;
    this.current = options.initial;
  }

  /**
   * 立即返回当前快照，过期时只安排检查，不等待外部环境。
   * @param options isForced 为 true 时忽略缓存有效期。
   * @returns 最近完成的状态；首次检查或配置失效后尚无结果时为 checking。
   * @throws 不抛出预期检查错误，检查失败记录为 failed。
   */
  getSnapshot(options: { isForced?: boolean } = {}): Status {
    void this.refreshExpired(options);
    return this.peekSnapshot();
  }

  /**
   * 在状态过期时等待检查结束，适用于只需要读取文件元数据的轻检查。
   * @param options 是否忽略缓存有效期。
   * @returns 最新已提交的状态；关闭后复用已有结果。
   * @throws 无预期错误。
   */
  async refreshExpired(options: { isForced?: boolean } = {}): Promise<Status> {
    if (!this.options.signal.aborted && (options.isForced || this.isExpired())) {
      await this.refresh();
    }
    return this.peekSnapshot();
  }

  /**
   * 只读取已保存状态，不启动检查，供后台内部观察当前连接。
   * @returns 当前缓存的浅副本。
   * @throws 无预期错误。
   */
  peekSnapshot(): Status {
    return { ...this.current };
  }

  /**
   * 等待本项最新一轮检查，其他连接不受影响。
   * @returns 该轮状态；检查错误映射为安全失败状态。
   * @throws 不向调用方传播原始检查错误。
   */
  refresh(): Promise<Status> {
    if (this.pending) return this.pending.promise;
    if (this.options.signal.aborted) return Promise.resolve({ ...this.current });
    const revision = this.revision;
    // 缓存到期只在后台刷新，保留已有结果，避免轮询周期等于有效期时始终显示检查中。
    if (this.checkedAt === undefined) {
      this.current = { ...this.current, state: 'checking', reason: 'none' };
    }
    const promise = this.scheduleCheck().then(
      (status) => this.finishCheck({ revision, status }),
      () =>
        this.finishCheck({
          revision,
          status: { ...this.current, state: 'failed', reason: 'unknown' },
        }),
    );
    this.pending = { revision, promise };
    return promise;
  }

  private isExpired(): boolean {
    const duration = this.options.cacheDurationMs ?? STATUS_CACHE_MS;
    return this.checkedAt === undefined || this.options.now() - this.checkedAt >= duration;
  }

  private scheduleCheck(): Promise<Status> {
    return new Promise((resolve, reject) => {
      // 将同步目录扫描也排到后续事件循环，确保首次 HTTP 状态响应先完成写入。
      this.options.schedule(() => {
        if (this.options.signal.aborted) {
          resolve(this.current);
          return;
        }
        Promise.resolve().then(this.options.check).then(resolve, reject);
      });
    });
  }

  private finishCheck(options: { revision: number; status: Status }): Status {
    // 配置更新或登录完成会提升版本；旧请求只结束自身，不能回写新状态。
    if (options.revision === this.revision) {
      this.current = options.status;
      this.checkedAt = this.options.now();
      if (this.pending?.revision === options.revision) this.pending = undefined;
      this.options.onChange?.({ ...this.current });
    }
    return { ...options.status };
  }

  /**
   * 使已有结果失效，并阻止尚未完成的旧请求写回。
   * @returns 无返回值。
   * @throws 不抛出预期错误。
   */
  invalidate(): void {
    this.revision++;
    this.checkedAt = undefined;
    this.pending = undefined;
  }

  /**
   * 保存已经完成校验的状态，同时废弃旧的异步检查。
   * @param status 新配置对应的有效状态。
   * @returns 无返回值。
   * @throws 不抛出预期错误。
   */
  setStatus(status: Status): void {
    this.invalidate();
    this.current = status;
    this.checkedAt = this.options.now();
  }
}
