// 合并同一支持单据的详情、处理记录和当前任务，仅返回经过投影的展示字段。
import {
  asObject,
  createTicketDetailFailure,
  getDingtalkConnectionKey,
} from '../../core/src/index.ts';
import type {
  JsonObject,
  TicketDetail,
  TicketDetailFailure,
  TicketDetailResult,
  TicketSummary,
} from '../../core/src/index.ts';
import { readApprovalPayload } from './approval-reading.ts';
import type { ApprovalPayloadQuery } from './approval-reading.ts';
import { classifyDingtalkReason } from './connection-reason.ts';
import { identify } from './identity.ts';
import type { Identity } from './identity.ts';
import { createTicketImageId, createTicketImageKey } from './ticket-image-id.ts';
import { canReadTickets, createTicketRunner } from './ticket-options.ts';
import type { TicketDetailOptions } from './ticket-options.ts';
import {
  mergeTicketTasks,
  projectCurrentTasks,
  projectTicketSummary,
} from './ticket-projection.ts';
import { collectTicketAttachments, projectTicketFields, readTicketText } from './ticket-values.ts';
import { mergeTicketRecords, projectTicketRecords } from './ticket-records.ts';
import { readTicketProgress } from './ticket-progress.ts';
import { readTicketReplyProgress } from './ticket-reply.ts';
import { createMemberNameResolver } from './member-name-resolver.ts';
import type { MemberNameResolver } from './member-name-resolver.ts';
import { resolveTicketMembers } from './ticket-members.ts';
import { isTicketTransferredToCurrentUser } from './ticket-transfer.ts';
import { rememberTicketWriteEvidence } from './ticket-write-evidence.ts';

type DetailParts = {
  payload: JsonObject;
  records: JsonObject | null;
  tasks: JsonObject | null;
  ticket: TicketSummary;
  identity: Identity;
  imageKey: Buffer;
  resolveMemberNames: MemberNameResolver;
};

type DetailQuery = Omit<ApprovalPayloadQuery, 'leaf'>;
type DetailPartRead = PromiseSettledResult<JsonObject>;
type DetailReadContext = { resolveIdentity: typeof identify; imageKey: Buffer };

let standaloneImageScope: { connectionKey: string; imageKey: Buffer } | undefined;

const PROCESS_FAILURE_REASONS = new Map<unknown, TicketDetailFailure['reason']>([
  ['spawn_failed', 'command-start'],
  ['output_limit', 'output-limit'],
  ['timeout', 'timeout'],
  ['aborted', 'aborted'],
  ['nonzero_exit', 'exit-error'],
]);

function getDetailReadFailure(
  part: TicketDetailFailure['part'],
  error: unknown,
): TicketDetailFailure {
  const { type, subtype } = asObject(error);
  // 仅比较固定执行器类别，不把异常正文、操作名或 CLI 返回的动态值交给网页。
  const reason =
    type === 'process'
      ? (PROCESS_FAILURE_REASONS.get(subtype) ?? 'process')
      : type === 'configuration' && subtype === 'runner_configuration'
        ? 'command-start'
        : type === 'parse' || type === 'protocol' || type === 'structure'
          ? 'invalid-response'
          : classifyDingtalkReason(error);
  return { part, reason };
}

function failDetail(failure: TicketDetailFailure): TicketDetailResult {
  return { ...createTicketDetailFailure(failure.reason), failures: [failure] };
}

async function retryMissingPart(options: {
  query: DetailQuery;
  part: 'records' | 'tasks';
  firstRead: DetailPartRead;
}): Promise<DetailPartRead> {
  if (options.firstRead.status === 'fulfilled') return options.firstRead;
  try {
    const value = await readApprovalPayload({ ...options.query, leaf: options.part });
    return { status: 'fulfilled', value };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function getMissingParts(records: DetailPartRead, tasks: DetailPartRead): TicketDetailFailure[] {
  const failures: TicketDetailFailure[] = [];
  if (records.status === 'rejected') failures.push(getDetailReadFailure('records', records.reason));
  if (tasks.status === 'rejected') failures.push(getDetailReadFailure('tasks', tasks.reason));
  return failures;
}

async function buildDetail(parts: DetailParts): Promise<TicketDetail> {
  const { userId } = parts.identity;
  const tasks = mergeTicketTasks(parts.payload.tasks, parts.tasks?.taskIdList);
  const records = mergeTicketRecords(
    parts.payload.operationRecords,
    parts.records?.operationRecords,
  );
  const names = await resolveTicketMembers({ ...parts, userId, records, tasks });
  const summary = projectTicketSummary({
    payload: { ...parts.payload, tasks },
    userId,
    fallback: parts.ticket,
    names,
  });
  const detail: TicketDetail = {
    summary: {
      ...summary,
      progress: readTicketProgress({
        summary,
        detail: parts.payload,
        supplemental: parts.records,
        records,
        userId,
      }),
      ...readTicketReplyProgress({
        detail: parts.payload,
        supplemental: parts.records,
        records,
        status: summary.status,
        userId,
      }),
      isTransferredToMe: isTicketTransferredToCurrentUser({
        detail: parts.payload,
        userId,
        sources: parts.ticket.sources,
      }),
    },
    businessId: readTicketText(parts.payload.businessId)?.trim() ?? null,
    fields: projectTicketFields(parts.payload.formValueVOS),
    attachments: collectTicketAttachments({
      fields: parts.payload.formValueVOS,
      attachments: parts.payload.attachments,
      records,
    }),
    records: projectTicketRecords({
      records,
      userId,
      names,
      createImageId: (url) =>
        createTicketImageId({
          key: parts.imageKey,
          identity: parts.identity,
          ticketId: summary.id,
          url,
        }),
    }),
    tasks: projectCurrentTasks({ tasks, userId, names }),
  };
  rememberTicketWriteEvidence({
    detail,
    rawDetail: parts.payload,
    taskList: parts.tasks,
    supplemental: parts.records,
    identity: parts.identity,
  });
  return detail;
}

async function readDetailParts(options: {
  query: DetailQuery;
  ticket: TicketSummary;
  identity: Identity;
  imageKey: Buffer;
  resolveMemberNames: MemberNameResolver;
  signal?: AbortSignal;
  shouldRetryParts?: boolean;
}): Promise<TicketDetailResult> {
  // 1. 并行读取三部分。2. 只补读缺失的处理记录或任务。3. 汇总安全原因和已读主体。
  const [payload, firstRecords, firstTasks] = await Promise.allSettled([
    readApprovalPayload({ ...options.query, leaf: 'detail' }),
    readApprovalPayload({ ...options.query, leaf: 'records' }),
    readApprovalPayload({ ...options.query, leaf: 'tasks' }),
  ]); // 1.
  options.signal?.throwIfAborted();
  if (payload.status === 'rejected') {
    return failDetail(getDetailReadFailure('detail', payload.reason));
  }
  const { query } = options;
  const [records, tasks] =
    options.shouldRetryParts === false
      ? [firstRecords, firstTasks]
      : await Promise.all([
          retryMissingPart({ query, part: 'records', firstRead: firstRecords }),
          retryMissingPart({ query, part: 'tasks', firstRead: firstTasks }),
        ]); // 2. 写入后回读只执行一次，不能因辅助接口失败另发一轮。
  options.signal?.throwIfAborted();
  const failures = getMissingParts(records, tasks); // 3.
  return {
    kind: failures.length ? 'partial' : 'success',
    reason: failures[0]?.reason ?? 'none',
    ...(failures.length ? { failures } : {}),
    detail: await buildDetail({
      payload: payload.value,
      records: records.status === 'fulfilled' ? records.value : null,
      tasks: tasks.status === 'fulfilled' ? tasks.value : null,
      ticket: options.ticket,
      identity: options.identity,
      imageKey: options.imageKey,
      resolveMemberNames: options.resolveMemberNames,
    }),
  };
}

/**
 * 1. 检查连接；2. 核实身份；3. 读取主体与辅助信息并生成纯文本详情。
 * @param options 当前选中账号、最近列表中的摘要和可替换环境依赖。
 * @param context 模块内部可替换的身份读取和当前读取范围使用的图片密钥。
 * @returns 主体失败时为 failure/null；辅助读取失败时返回 partial 和可展示部分。
 * @throws 无；原始错误只转换为安全原因类别，不落盘、不打印、不发送模型。
 */
export async function readTicketDetail(
  options: TicketDetailOptions,
  context: DetailReadContext,
): Promise<TicketDetailResult> {
  // 1. 不能在连接未就绪时退回 CLI 默认身份。
  if (!canReadTickets(options.connection)) return createTicketDetailFailure('connection-required');
  try {
    // 2. 校验身份和三类详情命令均经同一个无日志执行器。
    const run = createTicketRunner(options);
    const identity = await context.resolveIdentity(run, options.connection.selectedProfile!);
    options.signal?.throwIfAborted();
    const nameResolver = createMemberNameResolver();
    const resolveMemberNames =
      options.resolveMemberNames ??
      ((userIds) => nameResolver.resolve({ userIds, run, profile: identity.profile }));
    // 3. 三个独立只读命令同时执行，避免多次 CLI 启动延迟串行累加。
    return await readDetailParts({
      query: { run, instanceId: options.ticket.id, profile: identity.profile },
      ticket: options.ticket,
      identity,
      imageKey: context.imageKey,
      resolveMemberNames,
      signal: options.signal,
      shouldRetryParts: options.shouldRetryParts,
    });
  } catch (error) {
    return failDetail(
      options.signal?.aborted
        ? { part: 'detail', reason: 'aborted' }
        : getDetailReadFailure('detail', error),
    );
  }
}

/**
 * 单次读取详情；后台连续查询应使用 createTicketReader 共享身份核验结果。
 * @param options 当前账号、列表摘要和可替换读取依赖。
 * @returns 三接口并行读取后的详情及完整性，不返回原始身份信息。
 * @throws 无；异常转换为安全失败类别。
 */
export function getTicketDetail(options: TicketDetailOptions): Promise<TicketDetailResult> {
  const connectionKey = getDingtalkConnectionKey(options.connection);
  if (standaloneImageScope?.connectionKey !== connectionKey)
    standaloneImageScope = { connectionKey, imageKey: createTicketImageKey() };
  return readTicketDetail(options, {
    resolveIdentity: identify,
    imageKey: standaloneImageScope.imageKey,
  });
}
