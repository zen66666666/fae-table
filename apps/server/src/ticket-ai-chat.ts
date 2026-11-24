// 管理单据范围内的 AI 流、手册检索和加密问答，供本机对话接口使用。
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../packages/core/src/index.ts';
import type {
  AiChatContext,
  AiChatActiveStatus,
  AiChatHistory,
  AiChatStopResult,
  TicketDetail,
  TicketListItem,
  TicketPeopleResult,
} from '../../../packages/core/src/index.ts';
import { createManualTextIndex } from '../../../packages/manuals/src/index.ts';
import type { AiService } from '../../../packages/ai/src/index.ts';
import type { ManualService } from './manual-service.ts';
import {
  createTicketAiContext,
  createTicketAiSearch,
  createChatTextFilter,
} from './ticket-ai-context.ts';
import { getTicketAiHistoryKey } from './ticket-ai-history-files.ts';
import type { TicketAiHistory } from './ticket-ai-history.ts';
import { TicketAiRun } from './ticket-ai-run.ts';
import {
  STOPPED_TICKET_AI_ANSWER,
  streamTicketAiAnswer,
  waitForChatStage,
} from './ticket-ai-stream.ts';
import type { TicketAiDone, TicketAiQuestion } from './ticket-ai-stream.ts';
import type { TicketService } from './ticket-service.ts';

const STREAM_FAILED: TicketAiDone = { kind: 'done', outcome: { kind: 'unreachable' } };

type ActiveQuestion = TicketAiQuestion & {
  id: string;
  run: TicketAiRun;
  key: string;
};
type RetrievedManual = { manual: AiChatContext['manual']; isManualWithoutText?: true };

/** 与请求开始时的身份绑定的对话句柄，只能操作一张当前可读单据。 */
export type TicketChatAccess = {
  history: () => Promise<AiChatHistory | null>;
  clear: () => Promise<AiChatHistory | null>;
  ask: (question: string) => TicketAiRun | null;
  stop: (runId: string) => AiChatStopResult | null;
};

type ChatOptions = {
  signal: AbortSignal;
  ai: Pick<AiService, 'streamAnswer'>;
  tickets: Pick<TicketService, 'getConversationAccess' | 'getTicketDetail'>;
  manuals: Pick<ManualService, 'getTextSource'>;
  matchPeople: (detail: TicketDetail) => TicketPeopleResult;
  createId?: () => string;
  now?: () => number;
  history: TicketAiHistory;
  getPrivateDirectories: () => readonly (string | undefined)[];
};

/** 管理当前身份的进行中回答，完成的记录由独立的加密历史存储管理。 */
export class TicketAiChat {
  private readonly options: ChatOptions;
  private readonly textIndex = createManualTextIndex();
  private readonly pending = new Map<string, TicketAiRun>();
  private isChangingModel = false;
  private account?: string;

  /**
   * 创建空的对话和手册文字缓存。
   * @param options 绑定后台的读取、匹配、流传输和停止依赖。
   * @throws 无预期错误。
   */
  constructor(options: ChatOptions) {
    this.options = options;
    options.signal.addEventListener('abort', () => this.setAccount(undefined), { once: true });
  }

  /** 任意本机单据是否有已接收且尚未结束的回答，包括正在取得材料的请求。 */
  get isAnswering(): boolean {
    return this.pending.size > 0;
  }

  /**
   * 读取回答状态及当前列表仍可见的单据标识，不调用钉钉或 AI。
   * @returns 当前账号的安全进度；全局标志也涵盖暂时离开列表的回答。
   * @throws 无预期错误。
   */
  getActiveStatus(): AiChatActiveStatus {
    const ticketIds = [...this.pending.keys()].filter((id) =>
      this.options.tickets.getConversationAccess(id)?.canRead(),
    );
    return { ticketIds, isAnswering: this.isAnswering };
  }

  /**
   * 1. 确认没有回答或其他模型切换。2. 完成独占修改并在异常时也释放。
   * @param operation 已通过路由校验的模型修改操作。
   * @returns 成功修改后的结果。
   * @throws 正在回答或修改模型时抛出 ai_answering，其他异常由操作传播。
   */
  async withModelChange<T>(operation: () => Promise<T>): Promise<T> {
    // 1. 检查与占用之间不等待异步操作，避免问答和模型切换交叉进入。
    if (this.isAnswering || this.isChangingModel)
      throw new AppError('configuration', 'ai_answering', 'ai-model');
    this.isChangingModel = true;
    try {
      return await operation(); // 2.
    } finally {
      this.isChangingModel = false;
    }
  }

  /**
   * 更新本机账号范围，账号变化时取消进行中的请求。
   * @param account 已核实的本机范围标识，只用来隔离缓存。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  setAccount(account: string | undefined): void {
    if (this.account === account) return;
    this.account = account;
    for (const run of this.pending.values()) run.controller.abort();
    this.pending.clear();
  }

  /**
   * 绑定当前账号与最近列表的一张单据，后续读取均复核范围。
   * @param id 当前可见的单据标识。
   * @returns 安全历史和提问句柄；没有访问资格时返回 undefined。
   * @throws 无预期错误。
   */
  getAccess(id: string): TicketChatAccess | undefined {
    const access = this.options.tickets.getConversationAccess(id);
    const scope = this.account;
    if (!scope || !access) return undefined;
    const key = getTicketAiHistoryKey(scope, id);
    const canRead = (): boolean => this.account === scope && access.canRead();
    return {
      history: async () => {
        if (!canRead()) return null;
        const cached = this.pending.has(id) ? this.options.history.peek(key) : undefined;
        const history = cached ?? (await this.options.history.read(key));
        if (!canRead()) return null;
        const active = this.pending.get(id)?.snapshot;
        // 写入刚完成但内存运行标记还未清理时，仅返回已保存的一条，避免网页出现重影。
        return active && !history.turns.some((turn) => turn.id === active.runId)
          ? { ...history, active }
          : history;
      },
      clear: async () => {
        if (!canRead()) return null;
        if (this.pending.has(id))
          throw new AppError('configuration', 'ai_already_answering', 'ticket-ai-chat');
        const history = await this.options.history.clear(key);
        return canRead() ? history : null;
      },
      ask: (question) => (canRead() ? this.ask({ id, key, question }) : null),
      stop: (runId) => (canRead() ? this.stop(id, runId) : null),
    };
  }

  /**
   * 在完整读到当前账号列表后更新历史保留时间。
   * @param input 完整的单据及是否仅有当前账号。
   * @returns 无返回值，过期记录在后台清理。
   * @throws 无预期错误。
   */
  noteRecent(input: { items: readonly TicketListItem[]; isOnlyProfile: boolean }): void {
    if (this.account) this.options.history.noteRecent({ ...input, scope: this.account });
  }

  /**
   * 等待已完成问答的加密写入结束，供后台退出。
   * @returns 历史队列清空后完成。
   * @throws 无预期错误。
   */
  async waitForIdle(): Promise<void> {
    await this.options.history.waitForIdle();
  }

  /**
   * 用户打开详情时预提取已有手册的文字，不触发额外下载。
   * @param id 当前单据标识。
   * @returns 无返回值；不阻塞详情响应。
   * @throws 无预期错误。
   */
  warmManual(id: string): void {
    const access = this.options.tickets.getConversationAccess(id);
    if (!access?.canRead()) return;
    const { signal } = access;
    void this.options.manuals
      .getTextSource({ id, signal, isDownloadAllowed: false })
      .then((source) =>
        source && access.canRead() ? this.textIndex.extract({ source, signal }) : undefined,
      )
      .catch(() => {});
  }

  private ask(input: Pick<ActiveQuestion, 'id' | 'key' | 'question'>): TicketAiRun {
    // 1. 先占用本单，拒绝重复请求。2. 独立于网页连接启动生成。
    if (this.pending.has(input.id))
      throw new AppError('configuration', 'ai_already_answering', 'ticket-ai-chat'); // 1.
    if (this.isChangingModel) throw new AppError('configuration', 'ai_answering', 'ai-model');
    const run = new TicketAiRun({
      runId: (this.options.createId ?? randomUUID)(),
      question: input.question,
      startedAt: (this.options.now ?? Date.now)(),
    });
    this.pending.set(input.id, run);
    void this.runAnswer({
      ...input,
      run,
      signal: run.controller.signal,
      emit: (event) => run.publish(event),
    }); // 2.
    return run;
  }

  private stop(id: string, runId: string): AiChatStopResult {
    const run = this.pending.get(id);
    // 迟到的旧停止请求只能影响它所指定的回答，不会终止刚开始的新回答。
    if (!run || run.snapshot.runId !== runId) return { kind: 'not-running' };
    run.controller.abort();
    return { kind: 'stopped' };
  }

  private async runAnswer(input: ActiveQuestion): Promise<void> {
    let done: TicketAiDone;
    try {
      done = await this.answer(input);
    } catch {
      done = this.isCurrent(input) ? STREAM_FAILED : STOPPED_TICKET_AI_ANSWER;
    }
    if (this.pending.get(input.id) === input.run) this.pending.delete(input.id);
    input.emit(done);
  }

  private isCurrent(input: ActiveQuestion): boolean {
    // 问题在接收时已授权；同账号列表暂时不可读不会终止已经开始的回答。
    return !input.signal.aborted && this.pending.get(input.id) === input.run;
  }

  private async answer(input: ActiveQuestion): Promise<TicketAiDone> {
    // 1. 取得当前详情。2. 搜索本机手册并投影授权字段。3. 开始外发和流式回答。
    const { id, question, signal } = input;
    const snapshot = await waitForChatStage(signal, () => this.options.tickets.getTicketDetail(id)); // 1.
    if (!this.isCurrent(input)) return STOPPED_TICKET_AI_ANSWER;
    if (!snapshot?.detail) return { kind: 'done', outcome: { kind: 'detail-unavailable' } };
    const detail = snapshot.detail;
    const retrieved = await waitForChatStage(signal, () => this.searchManual(input, detail)); // 2.
    if (!this.isCurrent(input)) return STOPPED_TICKET_AI_ANSWER;
    const filter = createChatTextFilter(this.options.getPrivateDirectories());
    const context = createTicketAiContext({
      detail,
      filter,
      manual: retrieved?.manual ?? null,
      people: this.options.matchPeople(detail),
    });
    return await streamTicketAiAnswer({
      input,
      context,
      filter,
      isManualWithoutText: retrieved?.isManualWithoutText,
      ai: this.options.ai,
      history: this.options.history,
      createId: () => input.run.snapshot.runId,
      onQuestion: (text) => input.run.updateQuestion(text),
      isCurrent: () => this.isCurrent(input),
    }); // 3.
  }

  private async searchManual(
    input: ActiveQuestion,
    detail: TicketDetail,
  ): Promise<RetrievedManual> {
    const { id, signal, question } = input;
    try {
      const source = await this.options.manuals.getTextSource({
        id,
        signal,
        isDownloadAllowed: true,
      });
      if (!source || !this.isCurrent(input)) return { manual: null };
      const result = await this.textIndex.search({
        question: createTicketAiSearch(question, detail),
        sources: [source],
        signal,
      });
      const file = result.files[0];
      const pageCount = file?.pageCount;
      return {
        manual:
          pageCount && result.snippets.length ? { pageCount, passages: result.snippets } : null,
        isManualWithoutText: file?.kind === 'no-text' ? true : undefined,
      };
    } catch {
      // 下载、无文字层或解析失败不影响回答；空段落由网页标成未参考手册。
      return { manual: null };
    }
  }
}
