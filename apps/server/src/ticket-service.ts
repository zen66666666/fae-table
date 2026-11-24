// 编排单据列表、详情预读和草稿访问，通过当前身份限制各内存接口的单据范围。
import {
  createInitialTicketSnapshot,
  createTicketListSnapshotFailure,
  createTicketDetailSnapshotFailure,
} from '../../../packages/core/src/index.ts';
import type {
  TicketDetailSnapshot,
  TicketListSnapshot,
  TicketSummary,
} from '../../../packages/core/src/index.ts';
import type {
  DingtalkConnectionStatus,
  TicketReader,
  TicketReadOptions,
} from '../../../packages/dingtalk/src/index.ts';
import { getTicketApprovalPreview } from './ticket-approval-previews.ts';
import { TicketDetailCache } from './ticket-detail-cache.ts';
import { TicketDraftCache } from './ticket-draft-cache.ts';
import { shouldRetryTicketRead } from './ticket-prefetch.ts';
import { runTicketRefreshCycle } from './ticket-refresh-cycle.ts';
import { TicketReadScope } from './ticket-read-scope.ts';
import type { TicketAccess } from './ticket-read-scope.ts';
import { TicketRefreshScheduler } from './ticket-refresh-scheduler.ts';
import { createTicketResources } from './ticket-resources.ts';
import type {
  TicketDetailUpdate,
  TicketDetailUpdateOptions,
  TicketServiceOptions,
} from './ticket-service-types.ts';
import { TicketSnapshotStore } from './ticket-snapshot-store.ts';
import { createTicketWriteAccess } from './ticket-write-access.ts';
import type { TicketWriteAccess } from './ticket-write-access.ts';

/** 当前账号下只允许用于列表成员的单据写入访问。 */
export type { TicketWriteAccess } from './ticket-write-access.ts';

/** 一次对话使用的本机身份与列表范围，不包含可外发的身份数据。 */
export type { TicketConversationAccess } from './ticket-service-types.ts';

/** 当前身份的单据内存服务，负责刷新互斥、预读进度和详情成员门禁。 */
export class TicketService {
  private options: TicketServiceOptions;
  private reader: TicketReader;
  private details: TicketDetailCache;
  private drafts = new TicketDraftCache();
  private scheduler: TicketRefreshScheduler;
  private snapshots = new TicketSnapshotStore();
  private scope: TicketReadScope;
  private readonly resources: ReturnType<typeof createTicketResources>;
  /** 读取资料匹配所需的当前表单快照，不启动新的详情读取。 */
  readonly peekTicketFields: TicketService['resources']['peekTicketFields'];
  /** 固定手册读取开始时的账号，只交付仍允许读取的表单字段。 */
  readonly getTicketFieldsAccess: TicketService['resources']['getTicketFieldsAccess'];
  /** 提供会随账号失效的对话读取门禁。 */
  readonly getConversationAccess: TicketService['resources']['getConversationAccess'];
  /** 通过列表和当前详情门禁读取图片，不启动外部详情查询。 */
  readonly readTicketImage: TicketService['resources']['readTicketImage'];
  /** 为当前账号和最近列表成员提供内存草稿访问句柄。 */
  readonly getDraftAccess: TicketService['resources']['getDraftAccess'];

  /**
   * 创建空的内存缓存和调度器，等待钉钉状态回调后开始首次预读。
   * @param options 可替换的进程、读取器、时钟和停止信号。
   * @throws 依赖工厂构造失败时抛错，由后台启动入口处理。
   */
  constructor(options: TicketServiceOptions) {
    this.options = options;
    this.scope = new TicketReadScope(options.signal);
    this.reader =
      options.reader ?? options.dependencies.createTicketReader({ now: options.dependencies.now });
    this.details = new TicketDetailCache({
      now: options.dependencies.now,
      onRead: (read) => this.applyDetail(read),
    });
    this.resources = createTicketResources({
      getScope: () => this.scope.getAccess(),
      snapshots: this.snapshots,
      details: this.details,
      drafts: this.drafts,
      dependencies: options.dependencies,
    });
    this.peekTicketFields = this.resources.peekTicketFields;
    this.getTicketFieldsAccess = this.resources.getTicketFieldsAccess;
    this.getConversationAccess = this.resources.getConversationAccess;
    this.readTicketImage = this.resources.readTicketImage;
    this.getDraftAccess = this.resources.getDraftAccess;
    this.scheduler = new TicketRefreshScheduler({
      ...options.dependencies,
      signal: options.signal,
      refresh: () => this.refreshTickets(),
    });
    options.signal.addEventListener('abort', () => this.invalidate(), { once: true });
  }

  /**
   * 根据已完成的钉钉检查更新身份范围，连接变化立即作废所有缓存。
   * @param connection 仅用于本机服务的当前连接状态。
   * @returns 无返回值；就绪后的读取安排到后续事件循环。
   * @throws 无预期错误。
   */
  updateConnection(connection: DingtalkConnectionStatus): void {
    // 1. 核对新连接并取消旧范围。2. 同步草稿和对话范围。3. 安排就绪后的读取。
    const update = this.scope.prepareConnection(connection); // 1.
    if (!update) return;
    this.invalidate({ canKeepDrafts: true });
    // 临时不可读时关闭访问，保留同一个已核实范围的草稿；新的就绪账号会清除旧草稿。
    if (update.account) {
      this.drafts.setScope(update.account); // 2.
      this.options.onAccountScope?.(update.account);
    }
    this.scope.setConnection(update);
    if (!update.account) {
      this.snapshots.reset(
        connection.state === 'checking' || connection.state === 'unchecked'
          ? createInitialTicketSnapshot()
          : createTicketListSnapshotFailure('connection-required'),
      );
    }
    this.scheduler.setReady(Boolean(update.account)); // 3.
  }

  /**
   * 作废身份和单据范围并取消旧读取。
   * @param options 状态检查暂时失效时可保留不可访问的草稿；身份切换和退出时默认清除。
   * @returns 无返回值；旧轮结束前调度器不会启动第二轮刷新。
   * @throws 无预期错误。
   */
  invalidate(options: { canKeepDrafts?: boolean } = {}): void {
    this.scope.invalidate();
    this.resources.clearTicketImages();
    this.reader.invalidate();
    this.details.invalidate();
    if (!options.canKeepDrafts) {
      this.drafts.clear();
      this.options.onAccountScope?.(undefined);
    }
    this.snapshots.reset();
    this.scheduler.setReady(false);
    this.notify(this.options.onManualPrefetchItems, []);
  }

  /**
   * 记录已验证网页的访问时间，唤醒暂停的后台调度。
   * @returns 无返回值，不直接调用钉钉。
   * @throws 无预期错误。
   */
  noteActivity(): void {
    this.scheduler.noteActivity();
  }

  /**
   * 立即取得列表快照，绝不发起或等待外部命令。
   * @returns 排好序的当前结果、更新时间与本轮预读进度。
   * @throws 无预期错误。
   */
  getSnapshot(): TicketListSnapshot {
    return this.snapshots.read({
      isRefreshing: this.scheduler.isRefreshing,
      nextRefreshAt: this.scheduler.scheduledRefreshAt,
    });
  }

  /**
   * 请求提前刷新，并立即返回快照；当前轮未完成时复用该轮。
   * @returns 记录了刷新状态的当前内存结果。
   * @throws 无预期错误。
   */
  requestRefresh(): TicketListSnapshot {
    this.scheduler.requestRefresh();
    return this.getSnapshot();
  }

  private getReadOptions({ connection, signal }: TicketAccess): TicketReadOptions {
    const { environment, spawn, dependencies } = this.options;
    return { connection, signal, environment, spawn, now: dependencies.now };
  }

  private refreshTickets(): Promise<number | undefined> {
    const access = this.scope.getAccess();
    if (!access) return Promise.resolve(undefined);
    return runTicketRefreshCycle({
      snapshots: this.snapshots,
      details: this.details,
      now: this.options.dependencies.now,
      isCurrent: () => !access.signal.aborted,
      listTickets: () => this.reader.listTickets(this.getReadOptions(access)),
      readDetail: ({ ticket, isRetry }) =>
        this.readDetail({ ticket, access, isForced: true, canRetry: !isRetry }),
      onRecentTickets: (items) =>
        this.notify(this.options.onRecentTickets, {
          items,
          isOnlyProfile: access.connection.profiles.length === 1,
        }),
      onPrefetchComplete: (items) => this.notify(this.options.onManualPrefetchItems, items),
    });
  }

  private notify<Value>(callback: ((value: Value) => void) | undefined, value: Value): void {
    try {
      callback?.(value);
    } catch {
      // 资料和对话模块的通知失败不能影响已经缓存的结果或后续钉钉读取。
    }
  }

  private applyDetail(options: {
    ticket: TicketSummary;
    result: TicketDetailSnapshot;
    isRetryPending: boolean;
    isSingleUpdate: boolean;
  }): void {
    const { ticket, result, isRetryPending, isSingleUpdate } = options;
    if (!isRetryPending) this.snapshots.publishDetail({ id: ticket.id, result, isSingleUpdate });
    if (result.detail) {
      this.notify(this.resources.warmTicketImages, result.detail);
      this.notify(this.options.onDetailRead, result.detail);
    }
    if (isSingleUpdate) {
      if (shouldRetryTicketRead(result)) this.scheduler.requestDetailRetry();
      this.notify(this.options.onManualPrefetchItems, this.snapshots.items);
    }
  }

  private async readDetail(options: {
    ticket: TicketSummary;
    access: TicketAccess;
    isForced?: boolean;
    canRetry?: boolean;
    update?: TicketDetailUpdateOptions;
  }): Promise<TicketDetailSnapshot> {
    const { access, update } = options;
    if (access.signal.aborted) return createTicketDetailSnapshotFailure('connection-required');
    const result = await this.details.read({
      ticket: options.ticket,
      isForced: update !== undefined || options.isForced,
      canRetry: options.canRetry,
      isSingleUpdate: update !== undefined,
      isAfterCurrent: update?.isAfterCurrent,
      read: ({ ticket, signal }) =>
        this.reader.getTicketDetail({
          ...this.getReadOptions(access),
          signal: AbortSignal.any([access.signal, signal]),
          shouldRetryParts: update?.shouldRetryParts,
          ticket,
        }),
    });
    // 登录或账号变化后，即使读取完成也不能交付旧身份的内容。
    return access.signal.aborted
      ? createTicketDetailSnapshotFailure('connection-required')
      : result;
  }

  /**
   * 绑定写入服务使用的当前账号及列表单据。
   * @param id 来自受保护请求路径并等待校验的实例标识。
   * @returns 账号与单据仍可读时返回复核、草稿和刷新句柄。
   * @throws 无预期错误。
   */
  getWriteAccess(id: string): TicketWriteAccess | undefined {
    const entry = this.resources.findListedTicket(id);
    if ('reason' in entry) return undefined;
    const { access } = entry;
    const draft = this.getDraftAccess(id);
    if (!draft) return undefined;
    return createTicketWriteAccess({
      access,
      getListedTicket: () => this.snapshots.getItem(id),
      peekApproval: () =>
        getTicketApprovalPreview({
          ticket: this.snapshots.getItem(id),
          detail: this.details.peek(id)?.detail,
          hasFailedDetail: this.snapshots.hasFailedDetail(id),
        }),
      peekDetail: () => this.details.peek(id),
      draft,
      refresh: (update = {}) => this.readDetail({ ...entry, update }),
    });
  }

  /**
   * 把手动刷新绑定到当前单据和身份范围，等待请求体时也不能切换账号。
   * @param id 经过路径解码的单据标识。
   * @returns 可执行单张刷新的句柄，单据不在最近列表时返回 undefined。
   * @throws 无预期错误。
   */
  getTicketUpdateAccess(id: string): TicketDetailUpdate | undefined {
    const entry = this.resources.findListedTicket(id);
    if ('reason' in entry) return undefined;
    return (update = {}) => this.readDetail({ ...entry, update });
  }

  /**
   * 返回已缓存详情或现读，预读和点击同一单据只共用一次外部读取。
   * @param id 单据标识，必须通过格式检查并存在于当前最近列表。
   * @returns 带读取时间的详情，失效身份或列表成员返回安全失败。
   * @throws 读取异常由详情缓存转换为失败结果。
   */
  getTicketDetail(id: string): Promise<TicketDetailSnapshot> {
    // 1. 校验标识、身份与列表成员。2. 复用缓存并复核读取时的身份。
    const entry = this.resources.findListedTicket(id); // 1.
    if ('reason' in entry) return Promise.resolve(createTicketDetailSnapshotFailure(entry.reason));
    return this.readDetail(entry); // 2.
  }
}
