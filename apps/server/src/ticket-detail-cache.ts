// 在单据服务内合并详情请求并缓存已读取的展示结果，避免点击与预读重复调用 CLI。
import {
  createTicketDetailFailure,
  createTicketDetailSnapshotFailure,
  isTicketFinished,
} from '../../../packages/core/src/index.ts';
import { hasTicketOwnedRunningTask } from '../../../packages/dingtalk/src/index.ts';
import { shouldRetryTicketDetail } from './ticket-prefetch.ts';
import type {
  TicketDetailResult,
  TicketDetailSnapshot,
  TicketSummary,
} from '../../../packages/core/src/index.ts';

const FINISHED_DETAIL_TTL_MS = 30 * 60_000;

type CachedDetail = { status: string | null; readAt: number; result: TicketDetailSnapshot };
type ReadState = { isSingleUpdate: boolean };
type PendingDetail = {
  promise: Promise<TicketDetailSnapshot>;
  controller: AbortController;
  status: string | null;
  state: ReadState;
  followup?: Promise<TicketDetailSnapshot>;
};

/** 详情缓存依赖；实际读取和完成通知由单据服务按当前身份提供。 */
export type TicketDetailCacheOptions = {
  now: () => number;
  onRead: (options: {
    ticket: TicketSummary;
    result: TicketDetailSnapshot;
    isRetryPending: boolean;
    isSingleUpdate: boolean;
  }) => void;
};

/** 一次详情读取请求；isForced 用于刷新轮中的预读，仍复用同一 ID 的在途请求。 */
export type TicketDetailRead = {
  ticket: TicketSummary;
  read: (options: { ticket: TicketSummary; signal: AbortSignal }) => Promise<TicketDetailResult>;
  isForced?: boolean;
  /** 写入之前已开始的读取不能用于核实写入结果。 */
  isAfterCurrent?: boolean;
  /** 单张刷新可根据本次现场结果修正待处理标记。 */
  isSingleUpdate?: boolean;
  /** 首次后台预读可能需要补读，暂时性失败应保持待核实。 */
  canRetry?: boolean;
};

/** 保存当前列表允许访问的详情和在途读取，所有内容仅驻留内存。 */
export class TicketDetailCache {
  private options: TicketDetailCacheOptions;
  private revision = 0;
  private allowed = new Map<string, TicketSummary>();
  private cached = new Map<string, CachedDetail>();
  private pending = new Map<string, PendingDetail>();

  /**
   * 创建空缓存，不执行任何外部读取。
   * @param options 时钟与读取结果通知。
   * @throws 无预期错误。
   */
  constructor(options: TicketDetailCacheOptions) {
    this.options = options;
  }

  /**
   * 更新列表成员范围；部分列表未确认缺席时保留内部缓存，禁止通过接口访问。
   * @param tickets 最新一轮列表的摘要。
   * @param isComplete 是否已读完所有来源，只有完整列表才能确认缺席并删除缓存。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  setTickets(tickets: readonly TicketSummary[], isComplete = true): void {
    this.allowed = new Map(tickets.map((ticket) => [ticket.id, ticket]));
    for (const [id, cached] of this.cached) {
      const current = this.allowed.get(id);
      if (!current) {
        // 部分读取不能证明缺席；allowed 门禁仍会立即隐藏该缓存并取消在途访问。
        if (isComplete) this.cached.delete(id);
        continue;
      }
      const { detail } = cached.result;
      // 钉钉列表与详情的状态可能不同步，因此以两轮列表状态判断是否发生变化。
      if (!detail || current.status !== cached.status) {
        this.cached.delete(id);
      } else {
        this.cached.set(id, {
          ...cached,
          result: {
            ...cached.result,
            detail: {
              ...detail,
              summary: { ...detail.summary, sources: [...current.sources] },
            },
          },
        });
      }
    }
    for (const [id, pending] of this.pending) {
      const current = this.allowed.get(id);
      if (!current || current.status !== pending.status) {
        pending.controller.abort();
        this.pending.delete(id);
      }
    }
  }

  /**
   * 清空当前身份的全部详情，旧读取返回时不得写回。
   * @returns 无返回值；进程取消由单据服务统一信号负责。
   * @throws 无预期错误。
   */
  invalidate(): void {
    this.revision++;
    this.allowed.clear();
    this.cached.clear();
    for (const pending of this.pending.values()) pending.controller.abort();
    this.pending.clear();
  }

  /**
   * 仅查询当前列表内尚可复用的详情，用于预读、点击与资料匹配。
   * @param id 已通过当前账号列表门禁的单据标识。
   * @returns 已完成的详情快照；未缓存或已结束详情超过三十分钟时返回 undefined。
   * @throws 无预期错误。
   */
  peek(id: string): TicketDetailSnapshot | undefined {
    const ticket = this.allowed.get(id);
    const cached = this.cached.get(id);
    if (!ticket || !cached) return undefined;
    if (isTicketFinished(ticket)) {
      const age = this.options.now() - cached.readAt;
      if (age < 0 || age > FINISHED_DETAIL_TTL_MS) return undefined;
    }
    return cached.result;
  }

  /**
   * 优先返回已预读详情，否则复用或新建本实例的单次读取。
   * @param options 单据、读取函数和是否更新缓存。
   * @returns 带读取时间的详情结果；成员资格或身份变化返回安全失败。
   * @throws 读取异常转换为 unknown，不传播原始错误正文。
   */
  read(options: TicketDetailRead): Promise<TicketDetailSnapshot> {
    // 1. 校验最新列表成员并复用已有结果。2. 用原始列表摘要登记新读取。
    const id = options.ticket.id;
    const ticket = this.allowed.get(id); // 1.
    if (!ticket) return Promise.resolve(createTicketDetailSnapshotFailure('not-found'));
    const cached = this.peek(id);
    if (!options.isForced && cached) return Promise.resolve(cached);
    const pending = this.pending.get(id);
    if (pending) return this.reusePending(options, pending);
    const revision = this.revision;
    const controller = new AbortController();
    const state = { isSingleUpdate: options.isSingleUpdate === true };
    // 展示摘要可被详情补全，不能用它代替启动读取时的列表状态。
    const promise = this.readFresh(
      { ...options, ticket, signal: controller.signal, state },
      revision,
    ).finally(() => {
      if (this.pending.get(id)?.promise === promise) this.pending.delete(id);
    });
    this.pending.set(id, { promise, controller, status: ticket.status, state }); // 2.
    return promise;
  }

  private reusePending(
    options: TicketDetailRead,
    pending: PendingDetail,
  ): Promise<TicketDetailSnapshot> {
    if (pending.followup) return pending.followup;
    if (!options.isAfterCurrent) {
      if (options.isSingleUpdate) pending.state.isSingleUpdate = true;
      return pending.promise;
    }
    const revision = this.revision;
    // 写回后排在已经开始的读取之后，以新一批详情核实，且身份切换后不再读取。
    pending.followup = pending.promise.then(() =>
      revision === this.revision
        ? this.read({ ...options, isAfterCurrent: false })
        : createTicketDetailSnapshotFailure('connection-required'),
    );
    return pending.followup;
  }

  private async readFresh(
    options: TicketDetailRead & { signal: AbortSignal; state: ReadState },
    revision: number,
  ): Promise<TicketDetailSnapshot> {
    let result: TicketDetailResult;
    try {
      result = await options.read({ ticket: options.ticket, signal: options.signal });
    } catch {
      result = createTicketDetailSnapshotFailure('unknown');
    }
    // 旧身份和已移出列表的单据不能因为迟到响应重新进入内存缓存或网页。
    if (revision !== this.revision) return createTicketDetailSnapshotFailure('connection-required');
    const current = this.allowed.get(options.ticket.id);
    if (!current || current.status !== options.ticket.status || options.signal.aborted)
      return createTicketDetailSnapshotFailure('not-found');
    if (result.detail && result.detail.summary.id !== options.ticket.id) {
      result = createTicketDetailFailure('invalid-response');
    }
    const { isSingleUpdate } = options.state;
    const detail = this.projectRead({ result, current, isSingleUpdate });
    const readAt = this.options.now();
    const snapshot = { ...result, detail, readAt: new Date(readAt).toISOString() };
    if (detail)
      this.cached.set(options.ticket.id, { status: current.status, readAt, result: snapshot });
    this.options.onRead({
      ticket: options.ticket,
      result: snapshot,
      isRetryPending:
        !isSingleUpdate && options.canRetry === true && shouldRetryTicketDetail(snapshot),
      isSingleUpdate,
    });
    return snapshot;
  }

  private projectRead(options: {
    result: TicketDetailResult;
    current: TicketSummary;
    isSingleUpdate: boolean;
  }): TicketDetailSnapshot['detail'] {
    const { result, current, isSingleUpdate } = options;
    if (!result.detail) return null;
    // 单张刷新不改变列表成员门禁，只有明确验证到任务离开本人时才移除待处理标记。
    const hasLeftPending =
      isSingleUpdate &&
      result.kind === 'success' &&
      hasTicketOwnedRunningTask(result.detail) === false;
    const sources = hasLeftPending
      ? current.sources.filter((source) => source !== 'pending')
      : [...current.sources];
    return { ...result.detail, summary: { ...result.detail.summary, sources } };
  }
}
