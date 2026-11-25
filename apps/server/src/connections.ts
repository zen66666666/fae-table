// 组合钉钉、编码表、官网手册和 AI 接口，供后台路由读取各项状态和投影。
import { AppError } from '../../../packages/core/src/index.ts';
import type {
  AiStatus,
  CatalogFolderPickResult,
  LoginResult,
  WorkbenchStatus,
  TicketListSnapshot,
  TicketDetailSnapshot,
  TicketPeopleResult,
  TicketManualsResult,
  TicketManualResult,
} from '../../../packages/core/src/index.ts';
import { CatalogConnection } from './catalog-connection.ts';
import { createDpapiProtection } from '../../../packages/ai/src/index.ts';
import { CodeTableService } from './codetable-service.ts';
import { WORKBENCH_ROOT_DIRECTORY } from './constants.ts';
import { DingtalkConnection } from './dingtalk-connection.ts';
import { ManualService } from './manual-service.ts';
import type { TicketManualView } from './manual-service.ts';
import { TicketService } from './ticket-service.ts';
import { TicketAiChat } from './ticket-ai-chat.ts';
import { TicketAiHistory } from './ticket-ai-history.ts';
import { AI_HISTORY_FILE_BYTES, TicketAiHistoryFiles } from './ticket-ai-history-files.ts';
import type { TicketDraftAccess } from './ticket-draft-cache.ts';
import { TicketWriteService } from './ticket-write-service.ts';
import type { ConnectionContext } from './types.ts';

/** 维护连接状态，并提供当前工作台的编码表、单据和 AI 接口服务。 */
export class ConnectionService {
  /** AI 接口服务供受保护路由读写配置和发起显式连通测试。 */
  readonly ai: ReturnType<ConnectionContext['dependencies']['createAiService']>;
  /** 供受保护路由读取编码表状态与安排后台刷新。 */
  readonly codeTable: CodeTableService;
  /** 已绑定当前账号的单据 AI 对话，供受保护路由使用。 */
  readonly ticketAi: TicketAiChat;
  /** 验证单据写入准备与执行的内存服务，仅供受保护路由使用。 */
  readonly ticketWrites: TicketWriteService;
  private context: ConnectionContext;
  private dingtalk: DingtalkConnection;
  private catalog: CatalogConnection;
  private tickets: TicketService;
  private readonly manuals: ManualService;

  /**
   * 创建连接缓存和 AI 接口服务，并安排首次钉钉检查以驱动后台预读。
   * @param context 配置、数据目录和可替换外部依赖。
   * @throws 不抛出预期错误。
   */
  constructor(context: ConnectionContext) {
    this.context = context;
    const { dependencies, signal, dataDir, environment, spawn } = context;
    this.ai = dependencies.createAiService({
      dataDir,
      environment,
      spawn,
      signal,
      fetch: dependencies.fetch,
      now: dependencies.now,
      setTimer: dependencies.setTimer,
      clearTimer: dependencies.clearTimer,
    });
    this.codeTable = new CodeTableService(context);
    this.manuals = new ManualService(context, {
      peekTicketFields: (id) => this.tickets.peekTicketFields(id),
      getTicketFieldsAccess: (id) => this.tickets.getTicketFieldsAccess(id),
      onWriteFailure: (reason) => this.catalog.reportWriteFailure(reason),
    });
    this.dingtalk = new DingtalkConnection(context, {
      onChange: (status) => {
        // 仅在认证已失效或有效目录确认原账号不存在时终止；网络或进程瞬时故障继续回答。
        if (status.reason === 'login-required' || status.reason === 'profile-invalid')
          this.ticketAi.setAccount(undefined);
        this.tickets.updateConnection(status);
        this.codeTable.setConnection(status);
      },
      onInvalidate: (canKeepDrafts) => {
        this.tickets.invalidate({ canKeepDrafts });
        if (!canKeepDrafts) this.codeTable.setConnection(undefined);
      },
    });
    const ticketReader = dependencies.createTicketReader({ now: dependencies.now });
    const writer = dependencies.createTicketWriter({
      spawn,
      environment,
      now: dependencies.now,
      ticketReader,
    });
    this.tickets = new TicketService({
      ...context,
      reader: ticketReader,
      onDetailRead: ({ fields }) => this.manuals.warmLookup(fields),
      onManualPrefetchItems: (items) => this.manuals.setPrefetch(items),
      onRecentTickets: (input) => this.ticketAi.noteRecent(input),
      onAccountScope: (scope) => this.ticketAi.setAccount(scope),
    });
    this.ticketAi = new TicketAiChat({
      signal,
      now: dependencies.now,
      ai: this.ai,
      tickets: this.tickets,
      manuals: this.manuals,
      history: new TicketAiHistory({
        files: new TicketAiHistoryFiles(dataDir, dependencies.chatHistoryFileSystem),
        // 系统加密进程有固定超时；后台退出会等已经完成的问答持久化。
        protection: (dependencies.createChatHistoryProtection ?? createDpapiProtection)({
          environment,
          maxEncodedBytes: AI_HISTORY_FILE_BYTES,
        }),
        now: dependencies.now,
      }),
      getPrivateDirectories: () => this.getPrivateDirectories(),
      matchPeople: (detail) => this.codeTable.matchTicketFields(detail.fields),
    });
    this.ticketWrites = new TicketWriteService({
      writer,
      getAccess: (id) => this.tickets.getWriteAccess(id),
      now: dependencies.now,
      createSecret: dependencies.createSecret,
    });
    this.catalog = new CatalogConnection(context, (folder) => this.manuals.configureFolder(folder));
    // 后台首次启动就检查钉钉；就绪回调自动预读，无须等用户访问列表接口。
    this.dingtalk.refresh();
  }

  private getPrivateDirectories(): readonly string[] {
    const { dataDir, config, manualsDirectory, dependencies } = this.context;
    return [dataDir, config.catalogFolder, manualsDirectory, WORKBENCH_ROOT_DIRECTORY].flatMap(
      (directory) => {
        if (!directory) return [];
        try {
          return [directory, dependencies.fileSystem.realpathSync(directory)];
        } catch {
          // 目录不可用时仍过滤保存的原路径，小心处理实际位置无法解析的资料文件夹。
          return [directory];
        }
      },
    );
  }

  /**
   * 读取可显示的 AI 设置，并同步当前工作台是否有流式回答。
   * @returns 不携带凭据或单据信息的连接摘要。
   * @throws 本机配置读取失败时由状态请求统一报告。
   */
  async getAiStatus(): Promise<AiStatus> {
    const status = await this.ai.getStatus();
    return { ...status, isAnswering: this.ticketAi.isAnswering };
  }

  /**
   * 读取三项摘要，过期的钉钉和资料目录检查在后台刷新。
   * @returns 当前脱敏状态，不发起 AI 连通测试。
   * @throws AppError：后台已经关闭。
   */
  async getStatus(): Promise<WorkbenchStatus> {
    if (this.context.signal.aborted) throw new AppError('process', 'server_closed', 'status');
    const dingtalk = this.dingtalk.getStatus();
    const [catalog, ai] = await Promise.all([this.catalog.getSnapshot(), this.getAiStatus()]);
    return {
      dingtalk,
      catalog,
      ai,
    };
  }

  /**
   * 用户主动刷新连接状态，执行一次资料目录写入检查并异步更新 PDF 统计。
   * @returns 当前连接摘要；钉钉检查继续在后台运行。
   * @throws AppError 后台已经关闭。
   */
  async refreshStatus(): Promise<WorkbenchStatus> {
    this.dingtalk.refresh();
    await this.catalog.refresh();
    return this.getStatus();
  }

  /**
   * 启动固定的独立钉钉扫码登录。
   * @param profileKey 可选的本实例账号句柄。
   * @returns 安全的登录结果。
   * @throws AppError 账号无效或后台已关闭。
   */
  login(profileKey?: string): Promise<LoginResult> {
    return this.dingtalk.login(profileKey);
  }

  /**
   * 保存当前登录中可选的钉钉账号。
   * @param profileKey 本实例账号句柄。
   * @returns 保存后的后台连接状态。
   * @throws AppError 账号不在允许范围或设置保存失败。
   */
  async selectProfile(profileKey: string): Promise<WorkbenchStatus> {
    await this.dingtalk.selectProfile(profileKey);
    return this.getStatus();
  }

  /**
   * 获取单据列表内存快照，绝不等待或启动钉钉命令。
   * @returns 带完整性、更新时间及预读进度的当前结果。
   * @throws 无预期错误。
   */
  listTickets(): TicketListSnapshot {
    return this.tickets.getSnapshot();
  }

  /**
   * 记录已经验证的网页活动，供后台自动刷新调度使用。
   * @returns 无返回值；不直接运行钉钉命令。
   * @throws 无预期错误。
   */
  noteActivity(): void {
    this.tickets.noteActivity();
  }

  /**
   * 请求提前刷新单据，当前轮尚未完成时复用同一轮。
   * @returns 可立即交给网页的当前快照。
   * @throws 无预期错误。
   */
  refreshTickets(): TicketListSnapshot {
    return this.tickets.requestRefresh();
  }

  /**
   * 读取最近一次列表允许访问的单据详情。
   * @param id 单据标识，必须属于当前身份的最近列表。
   * @returns 详情、部分读取或安全失败结果。
   * @throws 读取失败由单据服务转换为失败结果。
   */
  async getTicketDetail(id: string): Promise<TicketDetailSnapshot> {
    const snapshot = await this.tickets.getTicketDetail(id);
    if (snapshot.detail) this.ticketAi.warmManual(id);
    return snapshot;
  }

  /**
   * 锁定当前账号的单张详情刷新，供受保护的请求在校验正文后执行。
   * @param id 当前最近列表的单据标识。
   * @returns 刷新句柄；单据不可访问时返回 undefined。
   * @throws 无预期错误。
   */
  getTicketUpdateAccess(id: string): ReturnType<TicketService['getTicketUpdateAccess']> {
    return this.tickets.getTicketUpdateAccess(id);
  }

  /**
   * 读取当前账号可见且最新详情仍包含的图片。
   * @param input 已解析的单据标识和图片编号。
   * @returns 已验证的图片及持续访问校验；图片不可读时返回 undefined。
   * @throws 无预期错误。
   */
  readTicketImage(
    input: Parameters<TicketService['readTicketImage']>[0],
  ): ReturnType<TicketService['readTicketImage']> {
    return this.tickets.readTicketImage(input);
  }

  /**
   * 用最近列表中该单据已读到的详情匹配研发人员。
   * @param id 当前账号可见的单据标识；网页不传产品型号。
   * @returns 当前内存中的匹配状态，单据不可见时返回 null。
   * @throws 无预期错误；不等待现场读取或索引更新。
   */
  getTicketPeople(id: string): TicketPeopleResult | null {
    const fields = this.tickets.peekTicketFields(id);
    if (fields === 'not-found') return null;
    if (typeof fields === 'string') return { kind: fields, matches: [] };
    return this.codeTable.matchTicketFields(fields);
  }

  /**
   * 仅从当前最近列表的已读单据查询手册缓存。
   * @param id 网页正在查看的单据标识。
   * @param options 手动更新时只绕过暂时不可用的查询缓存。
   * @returns 手册结果或查询阶段，单据不可见时返回 null。
   * @throws 无预期错误；网络出错由独立官网模块分类。
   */
  async getTicketManuals(
    id: string,
    options: { isForced?: boolean } = {},
  ): Promise<TicketManualsResult | null> {
    return await this.manuals.getStatus(id, options);
  }

  /**
   * 只为当前可见并已匹配的单据打开索引内的本机 PDF。
   * @param id 当前最近列表中的单据标识。
   * @param model 可选的当前单据内型号。
   * @returns 可串流的 PDF，单据或匹配不可用时返回 null。
   * @throws 下载及存储问题交给查看路由返回固定提示。
   */
  async getTicketManualView(id: string, model?: string): Promise<TicketManualView | null> {
    return await this.manuals.open(id, model);
  }

  /**
   * 显式更新当前单据的本机手册并保留原文件。
   * @param id 当前最近列表中的单据标识。
   * @param model 可选的当前单据内型号。
   * @returns 更新后的公开状态，单据或匹配不可用时返回 null。
   * @throws 读取或存储失败由路由映射为固定原因。
   */
  async redownloadTicketManual(id: string, model?: string): Promise<TicketManualResult | null> {
    return await this.manuals.redownload(id, model);
  }

  /**
   * 打开本机已确认的固定手册目录。
   * @returns 系统接受打开请求后完成。
   * @throws 资源管理器启动失败交由路由处理。
   */
  async openManualsFolder(): Promise<void> {
    await this.manuals.openFolder();
  }

  /**
   * 等待已开始的手册下载清理临时文件，供后台退出。
   * @returns 清理结束后完成。
   * @throws 无预期错误，下载失败由调用方处理。
   */
  async waitForManualsCleanup(): Promise<void> {
    await this.manuals.waitForCleanup();
  }

  /**
   * 获取绑定当前账号版本及最近列表的内存草稿句柄。
   * @param id 需要读取或保存草稿的单据标识。
   * @returns 当前可访问的草稿句柄，单据失效时返回 undefined。
   * @throws 无预期错误。
   */
  getTicketDraftAccess(id: string): TicketDraftAccess | undefined {
    return this.tickets.getDraftAccess(id);
  }

  /**
   * 只校验并保存资料目录，不等待其他连接检查。
   * @param folder 用户填写的目录。
   * @returns 保存后的当前快照，目录结果立即生效。
   * @throws AppError：目录无效、不可读或配置写入失败。
   */
  async setCatalogFolder(folder: string): Promise<WorkbenchStatus> {
    await this.catalog.save(folder);
    return this.getStatus();
  }

  /**
   * 打开仅供当前本机网页使用的资料文件夹选择窗口。
   * @returns 已选择的路径或取消、忙及失败状态。
   * @throws 无预期错误；不保存或验证目录。
   */
  pickCatalogFolder(): Promise<CatalogFolderPickResult> {
    return this.catalog.pickFolder();
  }
}
