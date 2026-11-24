// 管理当前钉钉账号的编码表状态、定时更新和单据研发人员查询。
import { getRetryDelay, getTicketProductModel } from '../../../packages/core/src/index.ts';
import type {
  CodeTableReason,
  CodeTableStatus,
  TicketField,
  TicketPeopleResult,
} from '../../../packages/core/src/index.ts';
import { canReadTickets } from '../../../packages/dingtalk/src/index.ts';
import type { DingtalkConnectionStatus } from '../../../packages/dingtalk/src/index.ts';
import type { CodeTableIndex } from '../../../packages/codetable/src/index.ts';
import type { ConnectionContext } from './types.ts';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRYABLE_FAILURES = new Set<CodeTableReason>(['timeout', 'download-failed', 'parse-failed']);
const MANUAL_ONLY_FAILURES = new Set<CodeTableReason>([
  'permission',
  'not-found',
  'multiple-files',
]);
const EMPTY_STATUS: CodeTableStatus = {
  state: 'waiting',
  reason: 'none',
  updatedAt: null,
  modelCount: 0,
  retryAt: null,
};

type CodeTableScope = { key: string; profile: string };
type CodeTableContext = Pick<
  ConnectionContext,
  'dataDir' | 'environment' | 'spawn' | 'signal' | 'dependencies'
>;

function getScope(connection: DingtalkConnectionStatus | undefined): CodeTableScope | undefined {
  if (!connection || !connection.selectedProfile || !canReadTickets(connection)) return undefined;
  const profile = connection.selectedProfile;
  const organization = connection.profiles.find((account) => account.profile === profile)?.corpId;
  return { profile, key: JSON.stringify([profile, organization]) };
}

/** 当前账号的内存索引；网络与解析任务串行，路由只访问当前状态。 */
export class CodeTableService {
  private readonly context: CodeTableContext;
  private readonly cleanup: Promise<void>;
  private scope?: CodeTableScope;
  private state = { ...EMPTY_STATUS };
  private index?: CodeTableIndex;
  private job?: { controller: AbortController; finished: Promise<void> };
  private timer?: ReturnType<typeof setTimeout>;
  private failureCount = 0;

  /**
   * 构造空索引，等待钉钉连接就绪。
   * @param context 本机运行位置、自有进程、停止信号与可替换的时钟和更新操作。
   * @throws 无预期错误。
   */
  constructor(context: CodeTableContext) {
    this.context = context;
    this.cleanup = Promise.resolve()
      .then(() =>
        context.dependencies.cleanupCodeTableDirectories({
          dataDir: context.dataDir,
          wait: context.dependencies.wait,
        }),
      )
      .catch(() => {});
    context.signal.addEventListener('abort', () => this.setConnection(undefined), { once: true });
  }

  /**
   * 根据已核实的连接状态更新索引可见范围，并为新账号安排首次读取。
   * @param connection 本实例的钉钉内部状态，退出或切换时可省略。
   * @returns 无返回值；读取在后台完成。
   * @throws 无预期错误。
   */
  setConnection(connection: DingtalkConnectionStatus | undefined): void {
    const scope = getScope(connection);
    if (scope?.key === this.scope?.key) return;
    // 连接失效或账号改变时立即移除索引，旧权限的数据不得继续显示。
    this.clearTimer();
    this.job?.controller.abort();
    this.index = undefined;
    this.failureCount = 0;
    this.state = { ...EMPTY_STATUS };
    this.scope = scope;
    this.refresh();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.context.dependencies.clearTimer(this.timer);
    this.timer = undefined;
  }

  /**
   * 读取当前索引状态，不触发任何外部请求。
   * @returns 阶段、失败原因、最近有效更新时间与型号数。
   * @throws 无预期错误。
   */
  getStatus(): CodeTableStatus {
    return { ...this.state };
  }

  /**
   * 安排一次后台更新，当前正在运行时复用既有任务。
   * @returns 当前状态，不等待下载或解析结果。
   * @throws 无预期错误。
   */
  refresh(): CodeTableStatus {
    // 1. 检查账号与串行条件。2. 发布读取状态并推迟外部工作。
    const scope = this.scope;
    if (!scope || this.job || this.context.signal.aborted) return this.getStatus(); // 1.
    this.clearTimer();
    this.state = { ...this.state, state: 'loading', reason: 'none', retryAt: null }; // 2.
    const controller = new AbortController();
    const finished = Promise.resolve()
      .then(() => this.update(scope, controller.signal))
      .finally(() => this.finish(scope));
    this.job = { controller, finished };
    return this.getStatus();
  }

  private async update(scope: CodeTableScope, signal: AbortSignal): Promise<void> {
    const { dataDir, environment, spawn, dependencies } = this.context;
    // 先清理上次遗留文件，避免启动扫描误删本轮新建目录。
    await this.cleanup;
    if (signal.aborted) return;
    const result = await Promise.resolve()
      .then(() =>
        dependencies.loadCodeTable({
          dataDir,
          environment,
          spawn,
          profile: scope.profile,
          signal,
          wait: dependencies.wait,
        }),
      )
      .catch(() => ({ kind: 'failure', reason: 'download-failed' }) as const);
    if (scope !== this.scope || signal.aborted) return;
    if (result.kind === 'failure') {
      this.index = undefined;
      if (RETRYABLE_FAILURES.has(result.reason)) this.failureCount++;
      this.state = { ...EMPTY_STATUS, state: 'failed', reason: result.reason };
      return;
    }
    this.failureCount = 0;
    this.index = result.index;
    this.state = {
      state: 'ready',
      reason: 'none',
      updatedAt: new Date(dependencies.now()).toISOString(),
      modelCount: result.index.modelCount,
      retryAt: null,
    };
  }

  private finish(scope: CodeTableScope): void {
    // 1. 释放当前任务。2. 如有账号切换先安排新账号。3. 根据结果安排下次读取。
    this.job = undefined; // 1.
    if (!this.scope || this.context.signal.aborted) return;
    // 旧任务完成清理后再启动新账号的首轮，任何时刻都只有一个工作簿在处理。
    if (scope !== this.scope) {
      // 2.
      this.refresh();
      return;
    }
    // 3. 这三类失败只能由用户修正；反复自动读取会持续得到同一结果。
    if (MANUAL_ONLY_FAILURES.has(this.state.reason)) return;
    const isRetry = RETRYABLE_FAILURES.has(this.state.reason);
    const delay = isRetry
      ? getRetryDelay({ failureCount: this.failureCount, maxDelayMs: REFRESH_INTERVAL_MS })
      : REFRESH_INTERVAL_MS;
    if (isRetry) {
      this.state = {
        ...this.state,
        retryAt: new Date(this.context.dependencies.now() + delay).toISOString(),
      };
    }
    this.timer = this.context.dependencies.setTimer(() => this.refresh(), delay);
  }

  /**
   * 使用已读详情中的指定产品型号字段匹配研发人员。
   * @param fields 已通过单据权限校验的投影字段。
   * @returns 匹配结果或未匹配的具体原因，无外部读取。
   * @throws 无预期错误。
   */
  matchTicketFields(fields: TicketField[]): TicketPeopleResult {
    const model = getTicketProductModel(fields);
    if (!model) return { kind: 'no-model', matches: [] };
    if (!this.index) return { kind: 'unavailable', matches: [] };
    const matches = this.index.match(model);
    return { kind: matches.length ? 'matched' : 'unmatched', matches };
  }

  /**
   * 后台关闭时等候已取消任务清理临时文件。
   * @returns 清理结束后的 Promise。
   * @throws 无预期错误。
   */
  async waitForCleanup(): Promise<void> {
    await this.cleanup;
    await this.job?.finished;
  }
}
