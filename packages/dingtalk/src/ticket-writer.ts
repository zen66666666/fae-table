// 使用预读证据执行单次钉钉写入并核实结果，供后台两步确认服务调用。
import { TICKET_ID_PATTERN } from '../../core/src/index.ts';
import type { DingtalkStatus, TicketDetail, TicketWriteAction } from '../../core/src/index.ts';
import { hasSameApprovalIdentity, verifyApprovalEvidence } from './approval-write-evidence.ts';
import type { ApprovalEvidence, DingtalkWriteVerification } from './approval-write-evidence.ts';
import {
  buildApprovalWrite,
  isApprovalProfile,
  validateApprovalWrite,
} from './approval-write-policy.ts';
import type { ApprovalWriteScope } from './approval-write-policy.ts';
import { identify } from './identity.ts';
import type { Identity } from './identity.ts';
import { createRunner, createScopedRunner } from './runner.ts';
import type { RunnerOptions } from './runner.ts';
import { canReadTickets, TICKET_COMMAND_TIMEOUT_MS } from './ticket-options.ts';
import { getTicketReaderIdentity } from './ticket-reader.ts';
import type { TicketReader } from './ticket-reader.ts';
import { getTicketWriteEvidence } from './ticket-write-evidence.ts';

const APPROVAL_WRITE_TIMEOUT_MS = 30_000;
const APPROVAL_WRITE_OUTPUT_BYTES = 256 * 1024;
const MAX_PROOF_AGE_MS = 30_000;
const UNAVAILABLE: DingtalkWriteState = Object.freeze({
  isReady: false,
  taskId: null,
});

/** 本次执行的预读凭据；原始账号和处理记录留在模块内。 */
export type DingtalkWriteState = Readonly<{
  isReady: boolean;
  taskId: string | null;
}>;

/** 写命令的固定结果，区分未启动与已经尝试但结果未确认。 */
export type DingtalkWriteResult = 'completed' | 'permission' | 'unverified' | 'not-started';

/** 绑定身份、预读证据和确认任务的执行参数。 */
export type DingtalkWriteStateInput = {
  id: string;
  connection: DingtalkStatus;
  signal: AbortSignal;
  detail: TicketDetail | null;
  taskId: string | null;
};

/** 已通过两步确认的操作与执行凭据，账号和任务编号由后台提供。 */
export type DingtalkWriteExecution = {
  state: DingtalkWriteState;
  action: TicketWriteAction;
  text: string;
  signal: AbortSignal;
};

/** 比较同一操作的预读证据和写回后的详情。 */
export type DingtalkWriteVerify = {
  before: DingtalkWriteState;
  after: TicketDetail | null;
  action: TicketWriteAction;
  text: string;
};

/** 进程和时间可以注入，默认只定位本机 CLI 且不开启日志。 */
export type TicketWriterOptions = Pick<RunnerOptions, 'spawn' | 'executable' | 'environment'> & {
  now?: () => number;
  /** 模拟进程可缩短写入等待时间；工作台使用固定默认值。 */
  writeTimeoutMs?: number;
  /** 与后台预读共用同一私有身份缓存。 */
  ticketReader?: TicketReader;
};

/** 后台写入器的最小契约，没有执行任意 CLI 命令的入口。 */
export type TicketWriter = {
  /** 绑定已有单据证据；身份缓存过期时只重新核实身份。 */
  createState: (input: DingtalkWriteStateInput) => Promise<DingtalkWriteState>;
  /** 消费同一写入器登记的凭据，最多启动一次已确认的操作。 */
  execute: (input: DingtalkWriteExecution) => Promise<DingtalkWriteResult>;
  /** 比较执行前后的信息，无证据时返回不确定。 */
  verify: (input: DingtalkWriteVerify) => DingtalkWriteVerification;
};

type Proof = {
  id: string;
  identity: Identity;
  evidence: ApprovalEvidence | null;
  issuedAt: number;
  signal: AbortSignal;
  isConsumed: boolean;
  execution?: Pick<DingtalkWriteExecution, 'action' | 'text'> & { sentAt: number };
};

class ApprovalWriter implements TicketWriter {
  private readonly options: TicketWriterOptions;
  private readonly now: () => number;
  private readonly proofs = new WeakMap<DingtalkWriteState, Proof>();

  constructor(options: TicketWriterOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  async createState(input: DingtalkWriteStateInput): Promise<DingtalkWriteState> {
    // 1. 检查预读任务与确认范围。2. 用已核实身份登记一次性凭据。
    const { id, connection, signal, taskId, detail } = input;
    const selected = connection.selectedProfile;
    if (
      !selected ||
      !isApprovalProfile(selected) ||
      !canReadTickets(connection) ||
      !TICKET_ID_PATTERN.test(id) ||
      signal.aborted
    )
      return UNAVAILABLE;
    const evidence = getTicketWriteEvidence(detail); // 1.
    if ((detail && detail.summary.id !== id) || (taskId && evidence?.ownedTaskId !== taskId))
      return UNAVAILABLE;
    try {
      const identityAccess = getTicketReaderIdentity(this.options.ticketReader);
      const identity =
        identityAccess?.peek(connection) ??
        (await this.readIdentity({ identityAccess, connection, selected, signal })); // 2.
      if (
        signal.aborted ||
        !isApprovalProfile(identity.profile) ||
        (evidence && !hasSameApprovalIdentity(identity, evidence.identity))
      )
        return UNAVAILABLE;
      const state: DingtalkWriteState = Object.freeze({ isReady: true, taskId });
      this.proofs.set(state, {
        id,
        identity,
        evidence,
        signal,
        issuedAt: this.now(),
        isConsumed: false,
      });
      return state;
    } catch {
      // 执行器与身份原文可能含敏感信息，只返回固定的不可用状态。
      return UNAVAILABLE;
    }
  }

  private readIdentity(options: {
    identityAccess: ReturnType<typeof getTicketReaderIdentity>;
    connection: DingtalkStatus;
    selected: string;
    signal: AbortSignal;
  }): Promise<Identity> {
    const { identityAccess, connection, selected, signal } = options;
    const run = createRunner({
      ...this.options,
      signal,
      canWriteLogs: false,
      timeoutMs: TICKET_COMMAND_TIMEOUT_MS,
    });
    return identityAccess ? identityAccess.read({ run, connection }) : identify(run, selected);
  }

  async execute(input: DingtalkWriteExecution): Promise<DingtalkWriteResult> {
    // 1. 消费预读凭据。2. 经独立白名单执行一次。3. 只投影固定的结果类别。
    const { state, action, text, signal } = input;
    const proof = this.proofs.get(state);
    if (
      !proof ||
      proof.isConsumed ||
      signal.aborted ||
      proof.signal.aborted ||
      this.now() - proof.issuedAt >= MAX_PROOF_AGE_MS ||
      (action !== 'comment' && !state.taskId)
    )
      return 'not-started';
    proof.isConsumed = true; // 1.
    try {
      const scope: ApprovalWriteScope = {
        id: proof.id,
        action,
        text,
        profile: proof.identity.profile,
        taskId: action === 'comment' ? null : state.taskId,
      };
      const command = buildApprovalWrite(scope);
      const run = createScopedRunner(
        {
          ...this.options,
          canWriteLogs: false,
          maxOutputBytes: APPROVAL_WRITE_OUTPUT_BYTES,
          timeoutMs: this.options.writeTimeoutMs ?? APPROVAL_WRITE_TIMEOUT_MS,
          signal: AbortSignal.any([signal, proof.signal]),
        },
        { validate: (argv) => validateApprovalWrite(argv, scope) },
      );
      if (signal.aborted || proof.signal.aborted) return 'not-started';
      proof.execution = { action, text, sentAt: this.now() }; // 2. 首条评论的时间窗从实际发送起算。
      const result = await run(command.argv);
      if (result.kind === 'success') return 'completed'; // 3.
      return result.error?.type === 'permission' ? 'permission' : 'unverified';
    } catch {
      // 抛错或结果不明只能交给只读核实，禁止执行器自动再发。
      return proof.execution ? 'unverified' : 'not-started';
    }
  }

  verify(input: DingtalkWriteVerify): DingtalkWriteVerification {
    const { before, after, text, action } = input;
    const previous = this.proofs.get(before);
    const current = getTicketWriteEvidence(after);
    if (
      !previous?.evidence ||
      !current ||
      previous.evidence === current ||
      previous.execution?.action !== action ||
      previous.execution.text !== text
    )
      return 'uncertain';
    return verifyApprovalEvidence({
      before: previous.evidence,
      after: current,
      action,
      text,
      taskId: before.taskId,
      sentAt: previous.execution.sentAt,
    });
  }
}

/**
 * 创建专供后台已确认审批使用的写入器，复用无日志身份读取与有界进程执行。
 * @param options 可替换的进程、程序定位和时钟依赖。
 * @returns 本实例拥有的预读凭据与受限写入接口。
 * @throws 无预期错误；启动、协议与权限故障返回固定状态。
 */
export function createTicketWriter(options: TicketWriterOptions = {}): TicketWriter {
  return new ApprovalWriter(options);
}
