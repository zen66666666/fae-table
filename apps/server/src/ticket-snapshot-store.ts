// 更新已脱敏单据的快照与预读进度，供单据服务发布给网页。
import {
  createInitialTicketSnapshot,
  isTicketFinished,
  sortTickets,
} from '../../../packages/core/src/index.ts';
import type {
  TicketDetailSnapshot,
  TicketListItem,
  TicketListResult,
  TicketListSnapshot,
  TicketReason,
  TicketSummary,
} from '../../../packages/core/src/index.ts';
import { applyTicketDetailSummary } from './ticket-prefetch.ts';
import type { TicketPrefetchPlan } from './ticket-prefetch.ts';

type PreparedList = {
  listed: TicketSummary[];
  fresh: TicketSummary[];
  carried: TicketListItem[];
};

/** 单据列表当前投影和本轮失败状态；所有变更同步完成。 */
export class TicketSnapshotStore {
  private snapshot = createInitialTicketSnapshot();
  private listed: TicketSummary[] = [];
  private hasUsableList = false;
  private listResult: Pick<TicketListResult, 'kind' | 'reason'> | undefined;
  private detailFailures = new Map<string, TicketReason>();

  /** 当前可见的内存条目，供单据服务检查本轮读取及资料资格。 */
  get items(): readonly TicketListItem[] {
    return this.snapshot.items;
  }

  /**
   * 查询当前快照内可见的单据。
   * @param id 经过路径校验的实例标识。
   * @returns 当前账号的名单条目，已不在列表时返回 undefined。
   * @throws 无预期错误。
   */
  getItem(id: string): TicketListItem | undefined {
    return this.snapshot.items.find((item) => item.id === id);
  }

  /**
   * 读取只供网页展示的快照，不启动刷新。
   * @param schedule 当前是否刷新，以及实际挂起的下一次读取时间。
   * @returns 快照和当前刷新标记。
   * @throws 无预期错误。
   */
  read(schedule: Pick<TicketListSnapshot, 'isRefreshing' | 'nextRefreshAt'>): TicketListSnapshot {
    return { ...this.snapshot, ...schedule };
  }

  /**
   * 清除旧身份的列表和详情状态。
   * @param snapshot 可选的空列表连接状态；默认使用首次读取状态。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  reset(snapshot = createInitialTicketSnapshot()): void {
    this.snapshot = snapshot;
    this.listed = [];
    this.hasUsableList = false;
    this.listResult = undefined;
    this.detailFailures.clear();
  }

  /**
   * 合并最新可用列表和未读完来源的旧成员资格。
   * @param result 当前账号最新的完整或部分列表。
   * @returns 详情门禁的原始摘要、本轮新读条目与仅由旧来源保留的展示条目。
   * @throws 无预期错误。
   */
  prepareList(result: TicketListResult): PreparedList {
    // 1. 新结果覆盖字段。2. 继承未读完的来源。3. 继续核实已确认的移交单据。
    const fresh = new Map(result.items.map((item) => [item.id, item])); // 1.
    const complete = new Set(
      result.sources.filter((source) => source.kind === 'success').map((source) => source.source),
    );
    const oldItems = new Map(this.snapshot.items.map((item) => [item.id, item]));
    const carried: TicketListItem[] = [];
    const previousSummaries: TicketSummary[] = [];
    for (const prior of this.listed) {
      const observed = fresh.get(prior.id);
      const oldItem = oldItems.get(prior.id);
      const sources =
        result.kind === 'partial' ? prior.sources.filter((source) => !complete.has(source)) : []; // 2.
      if (observed) {
        const current = sources.length
          ? { ...observed, sources: [...new Set([...observed.sources, ...sources])] }
          : observed;
        fresh.set(prior.id, this.keepTransferSummary(current, oldItem));
      } else if (oldItem && sources.length) {
        carried.push({ ...oldItem, sources });
        // 保留旧的原始摘要，以便详情缓存继续使用当时的列表状态。
        previousSummaries.push({ ...prior, sources });
      } else if (oldItem?.isTransferredToMe === true && !isTicketFinished(oldItem)) {
        // 3. 窗口外或刚结束的移交可能从列表消失。用详情确认终态，且不继承待处理资格。
        fresh.set(prior.id, this.keepTransferSummary({ ...prior, sources: ['executed'] }, oldItem));
      }
    }
    const freshSummaries = [...fresh.values()];
    return { listed: [...freshSummaries, ...previousSummaries], fresh: freshSummaries, carried };
  }

  private keepTransferSummary(current: TicketSummary, previous?: TicketListItem): TicketSummary {
    if (
      previous?.isTransferredToMe !== true ||
      isTicketFinished(previous) ||
      isTicketFinished(current)
    )
      return current;
    // 继续跟进已核实的移交关系，旧的详情展示字段由预读计划统一继承。
    return { ...current, isTransferredToMe: true };
  }

  /**
   * 发布列表刷新失败；已有可用结果时只更新错误，保留原读取时间和预读进度。
   * @param options 最近的失败结果和本轮列表返回时间。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  publishListFailure(options: { result: TicketListResult; readAt: number }): void {
    const { result, readAt } = options;
    this.listResult = { kind: 'failure', reason: result.reason };
    if (this.hasUsableList) {
      this.snapshot = {
        ...this.snapshot,
        ...this.listResult,
        sources: result.sources,
        listRefreshState: 'stale',
      };
      return;
    }
    this.snapshot = {
      ...createInitialTicketSnapshot(),
      ...this.listResult,
      sources: result.sources,
      updatedAt: new Date(readAt).toISOString(),
      prefetch: { completed: 0, total: 0, failed: 0 },
    };
  }

  /**
   * 发布最新列表与初始详情预读进度。
   * @param options 本轮列表结果、合并摘要、预读计划和列表读取时间。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  publishList(options: {
    result: TicketListResult;
    prepared: PreparedList;
    plan: TicketPrefetchPlan;
    readAt: number;
  }): void {
    const { result, prepared, plan, readAt } = options;
    this.listed = prepared.listed;
    this.hasUsableList = true;
    this.listResult = { kind: result.kind, reason: result.reason };
    const failed = new Set(
      plan.items.filter((item) => item.failures?.length).map((item) => item.id),
    );
    for (const id of this.detailFailures.keys()) {
      if (!failed.has(id)) this.detailFailures.delete(id);
    }
    this.snapshot = {
      ...result,
      items: sortTickets(plan.items),
      updatedAt: new Date(readAt).toISOString(),
      isRefreshing: true,
      nextRefreshAt: null,
      ...(result.kind === 'partial' ? { listRefreshState: 'partial' as const } : {}),
      prefetch: plan.progress,
    };
  }

  /**
   * 记入一张单据在本轮首读或补读的最终结果。
   * @param isFailed 该单据未读到完整详情时为 true。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  settleDetail(isFailed: boolean): void {
    const { prefetch } = this.snapshot;
    this.snapshot = {
      ...this.snapshot,
      prefetch: {
        ...prefetch,
        completed: prefetch.completed + 1,
        failed: (prefetch.failed ?? 0) + Number(isFailed),
      },
    };
  }

  /**
   * 投影详情和原因；保留列表来源本身已经报告的失败。
   * @param options 当前单据标识、已校验的快照和是否单张刷新。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  publishDetail(options: {
    id: string;
    result: TicketDetailSnapshot;
    isSingleUpdate: boolean;
  }): void {
    // 1. 更新条目与详情失败。2. 合并当前列表和详情的完整性。
    const { id, result, isSingleUpdate } = options;
    const items = this.snapshot.items.map((item) => {
      if (item.id !== id) return item;
      // 单张刷新的来源已经按最新任务证据修正，内部列表门禁仍保持不变。
      const sources = isSingleUpdate
        ? (result.detail?.summary.sources ?? item.sources)
        : item.sources;
      return applyTicketDetailSummary({ ...item, sources }, result); // 1.
    });
    if (result.kind === 'success') this.detailFailures.delete(id);
    else this.detailFailures.set(id, result.reason);
    const base = this.listResult; // 2.
    const detailReason = this.detailFailures.values().next().value;
    const kind =
      base?.kind === 'success' && detailReason ? 'partial' : (base?.kind ?? this.snapshot.kind);
    const reason =
      base?.kind !== 'success' ? (base?.reason ?? this.snapshot.reason) : (detailReason ?? 'none');
    this.snapshot = { ...this.snapshot, kind, reason, items: sortTickets(items) };
  }

  /**
   * 检查单据详情是否已确定读取失败。
   * @param id 当前单据标识。
   * @returns 是否有已结算的详情失败。
   * @throws 无预期错误。
   */
  hasFailedDetail(id: string): boolean {
    return this.detailFailures.has(id);
  }
}
