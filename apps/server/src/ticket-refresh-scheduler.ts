// 为单据服务安排按活动窗口的常规刷新和绝对时间的暂时性失败重试。
import { getRetryDelay } from '../../../packages/core/src/index.ts';
import { TICKET_ACTIVITY_WINDOW_MS, TICKET_REFRESH_MS } from './constants.ts';
import type { ServerDependencies } from './types.ts';

/** 刷新调度依赖；刷新返回列表或详情暂时性失败的毫秒时间，其他结果返回 undefined。 */
export type TicketRefreshSchedulerOptions = Pick<
  ServerDependencies,
  'now' | 'schedule' | 'setTimer' | 'clearTimer'
> & { signal: AbortSignal; refresh: () => Promise<number | undefined> };

/** 管理首次预读、活动窗口和刷新互斥，不读取业务数据。 */
export class TicketRefreshScheduler {
  private options: TicketRefreshSchedulerOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastActivity: number | undefined;
  private nextRefreshAt: number | undefined;
  private failureCount = 0;
  private detailFailureAt: number | undefined;
  private revision = 0;
  private isReady = false;
  private isRunning = false;
  private isQueued = false;
  private isRequested = false;

  /**
   * 建立尚未就绪的调度器。
   * @param options 时钟、调度和停止信号。
   * @throws 无预期错误；定时器依赖应遵守 Node 定时器契约。
   */
  constructor(options: TicketRefreshSchedulerOptions) {
    this.options = options;
    options.signal.addEventListener('abort', () => this.close(), { once: true });
  }

  /** 是否正在读取或已排队刷新，不等待后台读取完成。 */
  get isRefreshing(): boolean {
    return this.isReady && (this.isRunning || this.isQueued || this.isRequested);
  }

  /** 实际挂起的下一次刷新时刻；无活动访问而暂停时不交付过时的计划时间。 */
  get scheduledRefreshAt(): string | null {
    if (this.timer === undefined || this.nextRefreshAt === undefined) return null;
    return new Date(this.nextRefreshAt).toISOString();
  }

  /**
   * 更新连接门槛；每次恢复就绪都安排一次预读。
   * @param isReady 当前身份是否能读单据。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  setReady(isReady: boolean): void {
    if (this.isReady === isReady || this.options.signal.aborted) return;
    this.isReady = isReady;
    this.revision++;
    this.failureCount = 0;
    this.detailFailureAt = undefined;
    this.clearTimer();
    this.nextRefreshAt = undefined;
    this.isRequested = isReady;
    if (isReady) this.scheduleRefresh();
  }

  /**
   * 记录经验证的网页访问，休眠后恢复访问时安排补读。
   * @returns 无返回值；不会同步执行任何 CLI。
   * @throws 无预期错误。
   */
  noteActivity(): void {
    if (this.options.signal.aborted) return;
    const now = this.options.now();
    const hasResumed =
      this.lastActivity !== undefined && now - this.lastActivity >= TICKET_ACTIVITY_WINDOW_MS;
    this.lastActivity = now;
    // 页面轮询只维护活动窗口，不能改变重新尝试的绝对时间。
    if (hasResumed && this.failureCount === 0) this.requestRefresh();
    else this.armTimer();
  }

  /**
   * 手动提前刷新，或沿用已在执行的整轮读取。
   * @returns 无返回值，调用方可立即返回当前快照。
   * @throws 无预期错误。
   */
  requestRefresh(): void {
    if (!this.isReady || this.options.signal.aborted) return;
    if (this.isRunning) return;
    this.isRequested = true;
    this.scheduleRefresh();
  }

  /**
   * 把单张更新的暂时性失败交给原有刷新退避，不推迟已有的快速重试。
   * @returns 无返回值；当前列表轮次仍在运行时，在本轮结束后统一安排。
   * @throws 无预期错误。
   */
  requestDetailRetry(): void {
    if (!this.isReady || this.options.signal.aborted) return;
    if (this.isRunning) {
      this.detailFailureAt ??= this.options.now();
      return;
    }
    if (this.isQueued || this.failureCount > 0) return;
    this.scheduleRetry(this.options.now());
    this.armTimer();
  }

  private scheduleRefresh(): void {
    if (!this.isReady || this.isRunning || this.isQueued || this.options.signal.aborted) return;
    this.clearTimer();
    this.isQueued = true;
    // 把外部读取放到后续事件循环，GET 快照和 POST 刷新都能先完成响应。
    this.options.schedule(() => {
      void this.runRefresh().catch(() => {});
    });
  }

  private async runRefresh(): Promise<void> {
    this.isQueued = false;
    if (!this.isReady || this.isRunning || this.options.signal.aborted) return;
    this.isRunning = true;
    this.isRequested = false;
    const revision = this.revision;
    let failedAt: number | undefined;
    try {
      failedAt = await this.options.refresh();
    } finally {
      this.isRunning = false;
      if (revision === this.revision && this.isReady && !this.options.signal.aborted) {
        // 旧账号的结果不能把退避次数或截止时间转移给新账号。
        const retryAt = failedAt ?? this.detailFailureAt;
        this.detailFailureAt = undefined;
        if (retryAt === undefined) {
          this.failureCount = 0;
          this.nextRefreshAt = this.options.now() + TICKET_REFRESH_MS;
        } else {
          this.scheduleRetry(retryAt);
        }
      }
      // 账号变化可以在旧轮取消期间申请新轮；必须等旧轮结束才启动新身份读取。
      if (this.isRequested) this.scheduleRefresh();
      else this.armTimer();
    }
  }

  private scheduleRetry(failedAt: number): void {
    this.failureCount++;
    this.nextRefreshAt =
      failedAt +
      getRetryDelay({
        failureCount: this.failureCount,
        maxDelayMs: TICKET_REFRESH_MS,
      });
  }

  private armTimer(): void {
    this.clearTimer();
    if (
      !this.isReady ||
      this.isRunning ||
      this.isQueued ||
      this.options.signal.aborted ||
      this.nextRefreshAt === undefined
    )
      return;
    const now = this.options.now();
    if (
      this.failureCount === 0 &&
      (this.lastActivity === undefined || now - this.lastActivity >= TICKET_ACTIVITY_WINDOW_MS)
    )
      return;
    if (now >= this.nextRefreshAt) {
      this.requestRefresh();
      return;
    }
    this.timer = this.options.setTimer(() => this.armTimer(), this.nextRefreshAt - now);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.options.clearTimer(this.timer);
    this.timer = undefined;
  }

  private close(): void {
    this.clearTimer();
    this.isReady = false;
    this.isRequested = false;
    this.isQueued = false;
  }
}
