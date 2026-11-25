// 规划和执行分阶段详情预读，供单据服务发布列表、更新核实状态与计数。
import {
  getTicketGroup,
  getTicketProductModel,
  getTicketReplyStatus,
  isTicketFinished,
} from '../../../packages/core/src/index.ts';
import type {
  TicketDetailSnapshot,
  TicketListItem,
  TicketPrefetchProgress,
  TicketProgress,
  TicketReason,
  TicketSummary,
} from '../../../packages/core/src/index.ts';
import { TICKET_PREFETCH_CONCURRENCY } from './constants.ts';

const TRANSIENT_READ_REASONS = new Set<TicketReason>([
  'timeout',
  'process',
  'command-start',
  'output-limit',
  'exit-error',
  'unknown',
]);

type TransferOutSummary = Pick<
  TicketSummary,
  'isTransferredOut' | 'hasTransferOutActivity' | 'transferOutHandlerNames'
>;

/**
 * 结合上次核实的转出证据与最新列表来源，决定是否展示转出及处理人信息。
 * @param ticket 当前用于分组的摘要，包含最新已知状态及来源。
 * @param evidence 需要保留或应用的转出证据。
 * @returns 可覆盖旧投影的字段；不再属于转出分组时清除三个字段。
 * @throws 无预期错误。
 */
export function projectTransferOutSummary(
  ticket: TicketSummary,
  evidence?: TransferOutSummary,
): TransferOutSummary {
  // 复用分组优先级，避免来源、终态或移交方向变化后仍展示旧处理人姓名。
  const isVisible =
    evidence?.isTransferredOut === true &&
    getTicketGroup({ ...ticket, isTransferredOut: true }) === 'transferred-out';
  return {
    isTransferredOut: isVisible ? evidence.isTransferredOut : undefined,
    hasTransferOutActivity: isVisible ? evidence.hasTransferOutActivity : undefined,
    transferOutHandlerNames: isVisible ? evidence.transferOutHandlerNames : undefined,
  };
}

function readProductModel(snapshot?: TicketDetailSnapshot): string | undefined {
  return snapshot?.detail
    ? getTicketProductModel(snapshot.detail.fields)?.trim() || undefined
    : undefined;
}

function keepProgress(ticket: TicketSummary, previous: TicketListItem): TicketProgress | undefined {
  const progress = previous.progress;
  if (!progress || isTicketFinished(ticket)) return undefined;
  const isPending = ticket.sources.includes('pending');
  if (isPending === previous.sources.includes('pending')) return progress;
  // 列表已确认待处理来源有变化时，不继续显示上一次的处理人状态。
  return { ...progress, state: isPending ? 'waiting-for-me' : 'waiting-for-others' };
}

function createPrefetchItem(options: {
  ticket: TicketSummary;
  previous?: TicketListItem;
  cached?: TicketDetailSnapshot;
  shouldPreferListSummary?: boolean;
}): TicketListItem {
  const { ticket, previous, cached, shouldPreferListSummary } = options;
  const prior = previous?.verification === 'ready' ? previous : undefined;
  const cachedName = prior ? prior.initiator : cached?.detail?.summary.initiator;
  const summary: TicketSummary = {
    ...ticket,
    title: ticket.title ?? prior?.title ?? null,
    templateName: ticket.templateName ?? prior?.templateName ?? null,
    createdAt: ticket.createdAt ?? prior?.createdAt ?? null,
    initiator: shouldPreferListSummary
      ? (ticket.initiator ?? cachedName ?? null)
      : (cachedName ?? ticket.initiator),
    hasReplied: prior ? prior.hasReplied : ticket.hasReplied,
    hasConfirmedReceipt: prior ? prior.hasConfirmedReceipt : ticket.hasConfirmedReceipt,
    isCurrentActor: ticket.isCurrentActor ?? prior?.isCurrentActor ?? null,
    isAwaitingOthers:
      !ticket.sources.includes('pending') && (prior?.isAwaitingOthers ?? ticket.isAwaitingOthers),
    isTransferredToMe: ticket.isTransferredToMe === true || prior?.isTransferredToMe === true,
    progress: prior ? keepProgress(ticket, prior) : undefined,
  };
  const transferOut = projectTransferOutSummary(
    summary,
    prior ?? cached?.detail?.summary ?? ticket,
  );
  const projected = { ...summary, ...transferOut };
  const replyStatus = getTicketReplyStatus(projected);
  return {
    ...prior,
    ...projected,
    group: getTicketGroup(projected, replyStatus),
    replyStatus,
    verification: prior ? 'ready' : 'pending',
    detailReadAt: prior?.detailReadAt ?? null,
    productModel: prior ? prior.productModel : readProductModel(cached),
  };
}

/** 本轮列表条目、按先后顺序读取的两批摘要和初始进度。 */
export type TicketPrefetchPlan = {
  items: TicketListItem[];
  active: TicketSummary[];
  finished: TicketSummary[];
  /** 计划开始时的缓存对象，供本轮辨别后来完成的现场详情。 */
  previousDetails: ReadonlyMap<string, TicketDetailSnapshot>;
  progress: TicketPrefetchProgress;
};

type TicketReadOutcome = Pick<TicketDetailSnapshot, 'kind' | 'reason' | 'failures'>;
type TicketPrefetchRead = {
  isCurrent: () => boolean;
  read: (options: { ticket: TicketSummary; isRetry: boolean }) => Promise<TicketReadOutcome>;
  onSettled: (result: TicketReadOutcome) => void;
};

/**
 * 判断单据列表或列表来源的失败是否值得后台再次尝试。
 * @param result 已脱敏的单据读取结果。
 * @returns 暂时性进程、超时或未知错误为 true；权限、身份、协议和页数限制不重试。
 * @throws 无预期错误。
 */
export function shouldRetryTicketRead(result: TicketReadOutcome): boolean {
  return (
    result.kind !== 'success' &&
    (TRANSIENT_READ_REASONS.has(result.reason) ||
      result.failures?.some(({ reason }) => TRANSIENT_READ_REASONS.has(reason)) === true)
  );
}

/**
 * 判断是否需要补读单据主体，辅助部分已由读取器尝试过一次。
 * @param result 已脱敏的单据详情读取结果。
 * @returns 只有可能恢复的主体失败才返回 true，避免再次读取已经成功的部分。
 * @throws 无预期错误。
 */
export function shouldRetryTicketDetail(result: TicketReadOutcome): boolean {
  return result.kind === 'failure' && shouldRetryTicketRead(result);
}

/**
 * 把详情投影及核实状态应用到列表摘要，保留列表本轮的来源。
 * @param item 当前列表条目。
 * @param result 已通过身份和成员校验的详情快照。
 * @returns 利用原读取时间标记详情版本的条目。
 * @throws 无预期错误。
 */
export function applyTicketDetailSummary(
  item: TicketListItem,
  result: TicketDetailSnapshot,
): TicketListItem {
  // 1. 保留失败前的展示。2. 成功时用新详情更新并重新核实转出字段。
  const summary = result.detail?.summary;
  const failures =
    result.kind === 'success'
      ? undefined
      : (result.failures ?? [{ part: 'detail' as const, reason: result.reason }]);
  // 1. 辅助字段读取失败不能推翻上次核实的转出；条目已包含本轮列表的来源与状态。
  if (failures && item.verification === 'ready')
    return { ...item, ...projectTransferOutSummary(item, item), failures };
  const status = isTicketFinished(item) ? item.status : (summary?.status ?? item.status);
  const updated: TicketListItem = {
    ...item,
    ...summary,
    // 详情可能早于本轮列表，不能覆写最新的来源资格。
    sources: item.sources,
    status,
    // 详情未读到时无法核实处理进度；已证实的移交关系在本次跟进期间保留。
    hasReplied: summary?.hasReplied ?? false,
    hasConfirmedReceipt: summary?.hasConfirmedReceipt ?? false,
    isAwaitingOthers: !item.sources.includes('pending') && summary?.isAwaitingOthers === true,
    isTransferredToMe: item.isTransferredToMe === true || summary?.isTransferredToMe === true,
    progress: isTicketFinished({ status }) ? undefined : summary?.progress,
    verification: result.detail ? 'ready' : 'failed',
    detailReadAt: result.readAt,
    productModel: readProductModel(result),
    failures,
  };
  // 2. 只有完整详情可建立新的转出证据；成功后证据消失则应撤回旧投影。
  return { ...updated, ...projectTransferOutSummary(updated, failures ? item : summary) };
}

/**
 * 先复用仍有效的已结束详情，再把其余本轮单据按状态安排预读。
 * @param options 新取得的条目、仅由旧来源保留的条目及有效缓存读取函数。
 * @returns 所有可见条目及预读计划；已核实的保留条目和完整终态缓存计入完成数。
 * @throws 无预期错误；缓存依赖须同步读取内存。
 */
export function planTicketPrefetch(options: {
  tickets: readonly TicketSummary[];
  previous?: readonly TicketListItem[];
  carried?: readonly TicketListItem[];
  shouldPreferListSummary?: boolean;
  peek: (id: string) => TicketDetailSnapshot | undefined;
}): TicketPrefetchPlan {
  // 1. 保留上次可显示的条目。2. 终态缓存有效时直接完成，否则仍安排本轮读取。
  const active: TicketSummary[] = [];
  const finished: TicketSummary[] = [];
  const previous = new Map(options.previous?.map((item) => [item.id, item]));
  const previousDetails = new Map<string, TicketDetailSnapshot>();
  const items = options.tickets.map((ticket): TicketListItem => {
    const cached = options.peek(ticket.id); // 1.
    if (cached) previousDetails.set(ticket.id, cached);
    const item = createPrefetchItem({
      ticket,
      cached,
      previous: previous.get(ticket.id),
      shouldPreferListSummary: options.shouldPreferListSummary,
    });
    const isFinished = isTicketFinished(ticket);
    if (isFinished && !item.failures?.length && cached?.kind === 'success' && cached.detail) {
      const verified = applyTicketDetailSummary(item, cached); // 2.
      // 部分刷新时新读到的列表字段优先，缓存只补充详情的核实结果。
      return options.shouldPreferListSummary
        ? {
            ...verified,
            title: ticket.title,
            templateName: ticket.templateName,
            createdAt: ticket.createdAt,
            initiator: item.initiator,
            isCurrentActor: ticket.isCurrentActor ?? verified.isCurrentActor,
          }
        : verified;
    }
    (isFinished ? finished : active).push(ticket);
    return item;
  });
  const carried = options.carried ?? [];
  return {
    items: [...items, ...carried],
    active,
    finished,
    previousDetails,
    progress: {
      completed:
        items.length -
        active.length -
        finished.length +
        carried.filter((item) => item.verification !== 'pending').length,
      total: items.length + carried.length,
      failed: carried.filter((item) => item.verification === 'failed' || item.failures?.length)
        .length,
    },
  };
}

async function readBatch(options: {
  tickets: readonly TicketSummary[];
  isCurrent: () => boolean;
  read: (ticket: TicketSummary) => Promise<void>;
}): Promise<void> {
  const { tickets, read, isCurrent } = options;
  let index = 0;
  const readNext = async (): Promise<void> => {
    while (index < tickets.length && isCurrent()) await read(tickets[index++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(TICKET_PREFETCH_CONCURRENCY, tickets.length) }, readNext),
  );
}

/**
 * 完成未结束和已结束详情的首读，再统一补读一次暂时性失败。
 * @param options 两批摘要、身份复核、单次读取及最终完成通知。
 * @returns 首读及补读结束，或身份提前失效时完成。
 * @throws 注入的读取函数拒绝时向调用方传播，由调用方只处理安全结果。
 */
export async function runTicketPrefetch(
  options: Pick<TicketPrefetchPlan, 'active' | 'finished'> & TicketPrefetchRead,
): Promise<void> {
  // 1. 依次首读两批；2. 保留原次序补读失败项，每张只结算一次。
  const { active, finished, isCurrent, read, onSettled } = options;
  const failedIds = new Set<string>();
  const readAttempt =
    (isRetry: boolean) =>
    async (ticket: TicketSummary): Promise<void> => {
      const result = await read({ ticket, isRetry });
      if (!isCurrent()) return;
      if (!isRetry && shouldRetryTicketDetail(result)) failedIds.add(ticket.id);
      else onSettled(result);
    };
  const first = readAttempt(false); // 1.
  await readBatch({ tickets: active, isCurrent, read: first });
  await readBatch({ tickets: finished, isCurrent, read: first });
  // 2. 逐个消耗失败标识，确保同一个单据最多补读一次。
  const retry = [...active, ...finished].filter((ticket) => failedIds.delete(ticket.id));
  await readBatch({ tickets: retry, isCurrent, read: readAttempt(true) });
}
