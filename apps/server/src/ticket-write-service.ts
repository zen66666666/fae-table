// 核实并串行执行单据写回，供工作台受保护的两步确认接口使用。
import {
  getTicketHeading,
  normalizeTicketWriteText,
  TICKET_WRITE_TEXT_LIMIT,
} from '../../../packages/core/src/index.ts';
import type {
  TicketDetail,
  TicketListItem,
  TicketWriteAction,
  TicketWriteAvailability,
  TicketWriteOutcome,
  TicketWritePreparation,
} from '../../../packages/core/src/index.ts';
import type { TicketWriter } from '../../../packages/dingtalk/src/index.ts';
import type { TicketWriteAccess } from './ticket-service.ts';
import { hasPendingApprovalSource } from './ticket-write-access.ts';
import { TicketWriteConfirmations } from './ticket-write-confirmations.ts';

const REJECTABLE_TEMPLATE = '客服技术支持流程';
const NOT_ALLOWED = { kind: 'not-allowed' } as const;
const CHANGED = { kind: 'changed' } as const;
const BUSY = { kind: 'busy' } as const;
const UNCERTAIN = { kind: 'uncertain' } as const;

type WriteState = Awaited<ReturnType<TicketWriter['createState']>>;
type Intent = { id: string; action: TicketWriteAction; text: string };
type Review = Intent & { before: WriteState; draft: string | undefined };
type Gate = { id: string; access: TicketWriteAccess };
type CachedActions = { availability: TicketWriteAvailability; taskId: string | null };

type ServiceOptions = {
  writer: TicketWriter;
  getAccess: (id: string) => TicketWriteAccess | undefined;
  now: () => number;
  createSecret: () => string;
};

function supportsAction(ticket: TicketListItem | undefined, action: TicketWriteAction): boolean {
  if (!ticket) return false;
  // 抄送或结束流程可以尝试评论；处理动作必须以钉钉明确的待处理来源为前提。
  if (action === 'comment') return true;
  if (!hasPendingApprovalSource(ticket)) return false;
  return action !== 'reject' || ticket.templateName === REJECTABLE_TEMPLATE;
}

function getCachedActions(gate: Gate, ticket: TicketListItem): CachedActions {
  const actions: TicketWriteAction[] = ['comment'];
  if (!supportsAction(ticket, 'approve')) return { availability: { actions }, taskId: null };
  const preview = gate.access.peekApproval();
  if (preview.kind === 'loading') {
    return { availability: { actions, isDetailLoading: true }, taskId: null };
  }
  if (preview.kind === 'unavailable') {
    return {
      availability: { actions, reason: 'no-owned-running-task' },
      taskId: null,
    };
  }
  // 展示、确认和发送共用预读任务，执行阶段还要检查确认码绑定的任务是否仍在缓存中。
  actions.push('approve');
  if (supportsAction(ticket, 'reject')) actions.push('reject');
  return { availability: { actions }, taskId: preview.taskId };
}

function getPreparationDenial(availability: TicketWriteAvailability): TicketWriteOutcome {
  if (availability.isDetailLoading) return { ...NOT_ALLOWED, reason: 'detail-loading' };
  if (availability.reason) return { ...NOT_ALLOWED, reason: availability.reason };
  return NOT_ALLOWED;
}

function getReviewKey(gate: Gate): string {
  return JSON.stringify([gate.access.account, gate.id]);
}

/** 持有本实例的确认码和执行门禁；结果不明时先重新核实而不重发。 */
export class TicketWriteService {
  private readonly options: ServiceOptions;
  private readonly confirmations: TicketWriteConfirmations;
  private readonly running = new Set<string>();
  private readonly unresolved = new Map<string, Review>();

  /**
   * 绑定当前单据范围、钉钉写模块和本机时钟。
   * @param options 访问核验、钉钉依赖和确认码生成器。
   * @throws 无预期错误。
   */
  constructor(options: ServiceOptions) {
    this.options = options;
    this.confirmations = new TicketWriteConfirmations(options);
  }

  private getGate(id: string): Gate | undefined {
    const access = this.options.getAccess(id);
    return access?.getTicket() ? { access, id } : undefined;
  }

  /**
   * 只公布当前实际可见的操作，不返回任务标识或账号资料。
   * @param id 网页当前的单据标识。
   * @returns 同源网页可显示的动作。
   * @throws 无预期错误；核验失败时只保留评论。
   */
  getAvailability(id: string): TicketWriteAvailability {
    const gate = this.getGate(id);
    if (!gate) return { actions: [] };
    if (this.running.has(id)) return { actions: [], isBusy: true };
    const ticket = gate.access.getTicket();
    return ticket ? getCachedActions(gate, ticket).availability : { actions: [] };
  }

  /**
   * 仅从预读快照生成一次性确认摘要，不发起钉钉请求。
   * @param input 通过路由校验的单据、动作和用户意见。
   * @returns 确认摘要或安全拒绝结果。
   * @throws 无预期业务异常；随机源失败由路由安全处理。
   */
  prepare(input: Intent): TicketWritePreparation {
    // 1. 核实来源和正文。2. 按预读任务颁发身份绑定的确认码。
    const { id, action } = input;
    const gate = this.getGate(id);
    const ticket = gate?.access.getTicket();
    if (!gate || !ticket || !supportsAction(ticket, action)) return NOT_ALLOWED; // 1.
    if (this.running.has(id)) return BUSY;
    // 新意见替换旧确认，避免在之后的执行请求中使用旧正文。
    this.confirmations.revoke(id);
    if (input.text.length > TICKET_WRITE_TEXT_LIMIT) return NOT_ALLOWED;
    const text = normalizeTicketWriteText(input.text);
    if (action !== 'approve' && !text) return { kind: 'text-required' };
    let taskId: string | null = null;
    if (action !== 'comment') {
      const cached = getCachedActions(gate, ticket); // 2.
      if (!cached.availability.actions.includes(action) || !cached.taskId)
        return getPreparationDenial(cached.availability);
      taskId = cached.taskId;
    }
    const code = this.confirmations.issue({
      account: gate.access.account,
      signal: gate.access.signal,
      id,
      action,
      text,
      taskId,
    });
    return {
      kind: 'ready',
      code,
      summary: {
        ticketName: getTicketHeading(ticket),
        action,
        text,
        detailReadAt: gate.access.peekDetail()?.readAt ?? ticket.detailReadAt ?? null,
      },
    };
  }

  /**
   * 消耗确认码，沿用已核实的任务最多写入一次；发现缓存任务已变化时不启动写命令。
   * @param input 单据路径、确认码和可选的响应完成后调度函数。
   * @returns 钉钉结果核实后的固定类别。
   * @throws 无预期错误；命令意外退出只触发核实。
   */
  async execute(input: {
    id: string;
    code: string;
    deferRefresh?: (refresh: () => void) => void;
  }): Promise<TicketWriteOutcome> {
    // 1. 绑定当前账号并消耗确认码。2. 独占发送和必要的结果核实。
    const { id, code, deferRefresh = (refresh) => setImmediate(refresh) } = input;
    const gate = this.getGate(id);
    if (!gate) {
      const isConfirmationUsed = this.confirmations.wasUsed({ id, code }) ? true : undefined;
      return { ...NOT_ALLOWED, isConfirmationUsed };
    }
    const confirmation = { account: gate.access.account, id, code };
    const isConfirmationUsed = this.confirmations.wasUsed(confirmation) ? true : undefined;
    if (this.running.has(id)) return { ...BUSY, isConfirmationUsed };
    const grant = this.confirmations.take(confirmation); // 1.
    if (!grant) return { kind: 'invalid-confirmation', isConfirmationUsed };
    this.running.add(id); // 2.
    try {
      return await this.perform({ gate, intent: grant, taskId: grant.taskId, deferRefresh });
    } finally {
      this.running.delete(id);
    }
  }

  private async perform(options: {
    gate: Gate;
    intent: Intent;
    taskId: string | null;
    deferRefresh: (refresh: () => void) => void;
  }): Promise<TicketWriteOutcome> {
    // 1. 仅对上次存疑的操作回读。2. 按缓存任务和身份发送一次。3. 未明确成功时回读。
    const { gate, intent, taskId, deferRefresh } = options;
    const { action, text } = intent;
    const previous = await this.recheck(gate); // 1.
    if (previous) return previous;
    if (!this.canUseCachedAction(options)) return CHANGED;
    const { connection, signal } = gate.access;
    const before = await this.options.writer
      .createState({
        // 2.
        id: gate.id,
        connection,
        signal,
        detail: gate.access.peekDetail()?.detail ?? null,
        taskId,
      })
      .catch(() => undefined);
    if (!before?.isReady || signal.aborted) return NOT_ALLOWED;
    if (!this.canUseCachedAction(options)) return CHANGED;
    const review: Review = { ...intent, before, draft: gate.access.getDraft() };
    let result: Awaited<ReturnType<TicketWriter['execute']>>;
    try {
      result = await this.options.writer.execute({ state: before, action, text, signal });
    } catch {
      result = 'unverified';
    }
    if (result === 'not-started') return NOT_ALLOWED;
    if (result === 'completed') {
      this.finish(gate, review);
      deferRefresh(() => void this.refresh(gate)); // 3. 响应完成后仅后台刷新本单。
      return { kind: 'completed' };
    }
    return this.resolveUnverified({ gate, review, isPermissionDenied: result === 'permission' });
  }

  private canUseCachedAction(options: {
    gate: Gate;
    intent: Intent;
    taskId: string | null;
  }): boolean {
    const { gate, intent, taskId } = options;
    const ticket = gate.access.getTicket();
    if (!ticket || !supportsAction(ticket, intent.action)) return false;
    if (intent.action === 'comment') return true;
    const cached = getCachedActions(gate, ticket);
    return Boolean(
      taskId && cached.taskId === taskId && cached.availability.actions.includes(intent.action),
    );
  }

  private async resolveUnverified(options: {
    gate: Gate;
    review: Review;
    isPermissionDenied: boolean;
  }): Promise<TicketWriteOutcome> {
    const { gate, review, isPermissionDenied } = options;
    const after = await this.refresh(gate);
    const verified = this.verify({ gate, review, after });
    if (verified.kind === 'completed') {
      this.finish(gate, review);
      return verified;
    }
    if (isPermissionDenied && review.action === 'comment') return { kind: 'no-comment-permission' };
    if (verified.kind === 'changed') return verified;
    if (isPermissionDenied) return NOT_ALLOWED;
    // 首次回读没有命中，记录仍可能晚于响应到达。必须下一次核实通过才可再发。
    this.unresolved.set(getReviewKey(gate), review);
    return UNCERTAIN;
  }

  private verify(options: {
    gate: Gate;
    review: Review;
    after: TicketDetail | null;
  }): TicketWriteOutcome {
    const { gate, review, after } = options;
    const { before, action, text } = review;
    if (!after || gate.access.signal.aborted) return UNCERTAIN;
    try {
      return { kind: this.options.writer.verify({ before, after, action, text }) };
    } catch {
      // 回读或投影无法判断时保持待核实，新的确认码不能触发重发。
      return UNCERTAIN;
    }
  }

  private async recheck(gate: Gate): Promise<TicketWriteOutcome | undefined> {
    const key = getReviewKey(gate);
    const review = this.unresolved.get(key);
    if (!review) return undefined;
    const result = this.verify({ gate, review, after: await this.refresh(gate) });
    // 上一次未生效是唯一允许本次继续发送的结论；其他情况保留当前草稿。
    if (result.kind !== 'completed' && result.kind !== 'not-completed')
      return { kind: 'previous-uncertain' };
    this.unresolved.delete(key);
    return result.kind === 'completed' ? { kind: 'previous-completed' } : undefined;
  }

  private finish(gate: Gate, review: Review): void {
    if (!gate.access.getTicket()) return;
    try {
      if (review.action === 'comment') gate.access.clearDraft(review.draft);
    } catch {
      // 本机草稿失败不能改变已确认的钉钉结果。
    }
  }

  private async refresh(gate: Gate): Promise<TicketDetail | null> {
    try {
      const snapshot = await gate.access.refresh({ isAfterCurrent: true, shouldRetryParts: false });
      return snapshot.detail;
    } catch {
      return null;
    }
  }
}
