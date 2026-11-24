// 编排已读单据的官网查询、本机手册状态和预下载重试，供连接服务调用。
import { AppError, getTicketProductModels } from '../../../packages/core/src/index.ts';
import type {
  CatalogWriteFailureReason,
  ManualLookupResult,
  TicketField,
  TicketListItem,
  TicketManualResult,
  TicketManualsResult,
} from '../../../packages/core/src/index.ts';
import { createManualLookup } from '../../../packages/manuals/src/index.ts';
import type { ManualStore, ManualTextSource } from '../../../packages/manuals/src/index.ts';
import { ManualPrefetch } from './manual-prefetch.ts';
import { ManualStorage } from './manual-storage.ts';
import type { TicketService } from './ticket-service.ts';
import type { ConnectionContext } from './types.ts';

type FoundManual = Extract<ManualLookupResult, { kind: 'found' }>;
type TicketAccess = Pick<TicketService, 'peekTicketFields' | 'getTicketFieldsAccess'>;
type ManualServiceOptions = TicketAccess & {
  onWriteFailure: (reason: CatalogWriteFailureReason) => void;
};

/** 已打开的索引内本机 PDF，供受保护的路由串流响应。 */
export type TicketManualView = Awaited<ReturnType<ManualStore['open']>>;

/** 单个后台实例的手册查询、存储和预下载服务。 */
export class ManualService {
  private readonly context: ConnectionContext;
  private readonly tickets: TicketAccess;
  private readonly lookup: ReturnType<typeof createManualLookup>;
  private readonly storage: ManualStorage;
  private recentItems: readonly TicketListItem[] = [];
  private readonly prefetch: ManualPrefetch;

  /**
   * 配置手册服务与停止信号，资料目录就绪前保持暂停。
   * @param context 本机运行目录、手册目录选项及可替换依赖。
   * @param options 单据字段、身份检查与当前资料目录写入失败的通知。
   * @throws 无预期错误。
   */
  constructor(context: ConnectionContext, options: ManualServiceOptions) {
    this.context = context;
    this.tickets = options;
    const { dependencies, signal } = context;
    this.lookup = createManualLookup({ fetch: dependencies.fetch, now: dependencies.now, signal });
    this.storage = new ManualStorage({
      context,
      lookup: this.lookup,
      onWriteFailure: options.onWriteFailure,
    });
    this.prefetch = new ManualPrefetch({
      dependencies,
      signal,
      storage: this.storage,
      peekTicketFields: this.tickets.peekTicketFields,
      getOrLookup: (model, store) => this.getOrLookup(model, store),
    });
  }

  /**
   * 启用已核实的资料目录，目录变更时取消旧任务并用已读单据重新安排预下载。
   * @param folder 产品资料使用的有效目录；未就绪时省略。
   * @returns 已完成配置和索引切换时结束；官网查询在后台继续。
   * @throws 新目录或运行索引无法绑定时向设置服务报告。
   */
  async configureFolder(folder?: string): Promise<void> {
    // 1. 更换目录期间停止未开始的下载。2. 新存储就绪后恢复已有单据资料。
    const { hasChanged, ready } = this.storage.configure(folder);
    if (hasChanged) this.prefetch.reconcile(); // 1.
    const current = await ready;
    if (!hasChanged || !current || current !== this.storage.active) return;
    for (const item of this.recentItems) {
      // 2.
      const fields = this.tickets.peekTicketFields(item.id);
      if (typeof fields !== 'string') this.warmLookup(fields);
    }
    this.prefetch.reconcile();
  }

  private async getKnownLookup(
    model: string,
    store: ManualStore,
  ): Promise<ManualLookupResult | undefined> {
    const cached = this.lookup.peek(model);
    if (cached?.kind === 'found' || cached?.kind === 'invalid-model') return cached;
    // 重启时优先恢复已下载型号对应的官网匹配，打开完好的本机文件不用访问官网。
    const stored = await store.getStoredLookup(model).catch(() => undefined);
    return stored ?? cached;
  }

  private async getOrLookup(model: string, store: ManualStore): Promise<ManualLookupResult> {
    return (await this.getKnownLookup(model, store)) ?? (await this.lookup.lookup(model));
  }

  /**
   * 详情就绪后提前准备右栏的手册查找结果；已安装的型号直接使用运行索引。
   * @param fields 已读详情中的表单字段。
   * @returns 无返回值，后台处理完成前不阻塞详情。
   * @throws 无预期错误。
   */
  warmLookup(fields: readonly TicketField[]): void {
    const store = this.storage.active;
    if (!store) return;
    for (const model of getTicketProductModels(fields))
      void this.getOrLookup(model, store).catch(() => {});
  }

  private getManualAccess(
    id: string,
    selected?: string,
  ): { model: string; canRead: () => boolean } | undefined {
    const getFields = this.tickets.getTicketFieldsAccess(id);
    if (!getFields) return undefined;
    const models = getTicketProductModels(getFields() ?? []);
    // 请求参数只是当前单据字段的选择器，不能将任意查询词送给官网。
    const model = selected === undefined ? models[0] : models.find((entry) => entry === selected);
    if (!model) return undefined;
    return { model, canRead: () => getTicketProductModels(getFields() ?? []).includes(model) };
  }

  private async projectFound(options: {
    model: string;
    result: FoundManual;
    store: ManualStore;
  }): Promise<TicketManualResult> {
    const { model, result, store } = options;
    const stored = await store.getSaved(model).catch(() => null);
    return { ...result, stored, isPreparing: !stored && this.prefetch.hasPending(model) };
  }

  /**
   * 读取本机状态，必要时安排官网查询；仅等待运行索引入口，不等待网络。
   * @param id 当前最近列表中的单据标识。
   * @param options 手动更新时仅绕过暂时失败的查询状态。
   * @returns 查询结果、本机存储状态或进行中标记；单据不可见时为 null。
   * @throws 无预期错误。
   */
  async getStatus(
    id: string,
    options: { isForced?: boolean } = {},
  ): Promise<TicketManualsResult | null> {
    const fields = this.tickets.peekTicketFields(id);
    if (fields === 'not-found') return null;
    const store = this.storage.active;
    if (!store) return { kind: 'folder-required' };
    if (typeof fields === 'string') return { kind: fields };
    return this.readModelStatuses({ id, store, isForced: options.isForced });
  }

  private async readModelStatuses(options: {
    id: string;
    store: ManualStore;
    isForced?: boolean;
  }): Promise<TicketManualsResult | null> {
    // 1. 读取当前可见型号。2. 投影各项缓存，再核实读取期间是否更换了单据或资料目录。
    const { id, store, isForced } = options;
    const getFields = this.tickets.getTicketFieldsAccess(id); // 1.
    if (!getFields) return null;
    const models = getTicketProductModels(getFields() ?? []);
    if (!models.length) return { kind: 'no-model' };
    const entries = await Promise.all(
      models.map(async (model) => ({
        model,
        result: await this.readModelStatus({ model, store, isForced }),
      })),
    ); // 2.
    const current = getTicketProductModels(getFields() ?? []);
    if (models.length !== current.length || models.some((model, index) => model !== current[index]))
      return null;
    if (store !== this.storage.active) return { kind: 'folder-required' };
    return entries.length === 1 ? entries[0].result : { kind: 'multiple', entries };
  }

  private async readModelStatus(options: {
    model: string;
    store: ManualStore;
    isForced?: boolean;
  }): Promise<TicketManualResult> {
    const { model, store, isForced } = options;
    const result = await this.getKnownLookup(model, store);
    if (result?.kind === 'found') return await this.projectFound({ model, result, store });
    if (result && !(result.kind === 'unavailable' && isForced)) return result;
    if (store === this.storage.active) void this.lookup.lookup(model, { isForced }).catch(() => {});
    return { kind: 'loading' };
  }

  /**
   * 校验当前单据仍能读后，读取已索引文件或等待需要的下载。
   * @param id 当前最近列表中的单据标识。
   * @param selected 可选的单据内型号，多型号单据可选择打开其中一份。
   * @returns 可以串流的本机 PDF，失效或未匹配时返回 null。
   * @throws 本机文件和官网失败交给本机查看路由显示固定中文提示。
   */
  async open(id: string, selected?: string): Promise<TicketManualView | null> {
    // 1. 核实匹配和可见性。2. 打开文件并再次核实，避免迟到响应送出旧范围资料。
    const store = this.storage.active;
    const access = this.getManualAccess(id, selected);
    if (!store || !access) return null;
    const { model, canRead } = access;
    const result = await this.getOrLookup(model, store); // 1.
    if (result.kind !== 'found' || !canRead() || store !== this.storage.active) return null;
    const file = await this.storage.observeWrite(store, () => store.open(model));
    if (canRead() && store === this.storage.active) return file; // 2.
    file.stream.destroy();
    return null;
  }

  /**
   * 给本机检索取得经核实的手册，无现成文件时仅在提问步骤允许下载。
   * @param options 可读单据、是否允许下载以及本次操作信号。
   * @returns 可安全读取的本机文件来源，单据或资料不可读时返回 undefined。
   * @throws 读取或下载失败由提问方按无手册处理。
   */
  async getTextSource(options: {
    id: string;
    isDownloadAllowed: boolean;
    signal: AbortSignal;
  }): Promise<ManualTextSource | undefined> {
    const { id, isDownloadAllowed, signal } = options;
    const store = this.storage.active;
    const access = this.getManualAccess(id);
    if (!store || !access || signal.aborted) return undefined;
    const { model, canRead } = access;
    const result = isDownloadAllowed
      ? await this.getOrLookup(model, store)
      : await this.getKnownLookup(model, store);
    if (result?.kind !== 'found' || !canRead() || signal.aborted || store !== this.storage.active)
      return undefined;
    return await this.storage.observeWrite(store, () =>
      store.openTextSource(model, { isDownloadAllowed }),
    );
  }

  /**
   * 显式重新下载当前已核实型号的手册，保留旧文件。
   * @param id 当前最近列表中的单据标识。
   * @param selected 可选的单据内型号，多型号单据可选择重新下载其中一份。
   * @returns 重新下载后的公开状态；失效时返回 null。
   * @throws 下载或索引更新失败，由路由安全处理。
   */
  async redownload(id: string, selected?: string): Promise<TicketManualResult | null> {
    // 1. 核实匹配和可见性。2. 重新下载，并读取本机状态。
    const store = this.storage.active;
    const access = this.getManualAccess(id, selected);
    if (!store || !access) return null;
    const { model, canRead } = access;
    const result = await this.getOrLookup(model, store); // 1.
    if (result.kind !== 'found' || !canRead() || store !== this.storage.active) return null;
    await this.storage.observeWrite(store, () => store.ensure(model, { isForced: true })); // 2.
    const status = await this.projectFound({ model, result, store });
    return canRead() && store === this.storage.active ? status : null;
  }

  /**
   * 打开系统资源管理器中的固定手册目录，目录由本机选项决定。
   * @returns 系统已接受打开请求后完成。
   * @throws 目录创建、校验或启动资源管理器失败时抛错。
   */
  async openFolder(): Promise<void> {
    const store = this.storage.active;
    if (!store) throw new AppError('validation', 'folder-required', 'manuals');
    const directory = await store.getDirectory();
    if (store !== this.storage.active)
      throw new AppError('validation', 'folder-required', 'manuals');
    const { dependencies, environment, signal } = this.context;
    await dependencies.openManualsDirectory({ directory, environment, signal });
  }

  /**
   * 更新手册预下载范围。
   * @param items 当前最近列表；账号失效时为空。
   * @returns 无返回值，下载在后台进行。
   * @throws 无预期错误。
   */
  setPrefetch(items: readonly TicketListItem[]): void {
    this.recentItems = items;
    this.prefetch.setItems(items);
  }

  /**
   * 等待已经启动的本机文件操作完成清理。
   * @returns 所有已启动下载结束后完成。
   * @throws 无预期错误，单项失败由调用方处理。
   */
  async waitForCleanup(): Promise<void> {
    await this.storage.waitForIdle();
  }
}
