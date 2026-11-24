// 有界读取并合并当前账号的支持单据；原始内容只留在内存，不记录日志。
import { createTicketListFailure } from '../../core/src/index.ts';
import type {
  TicketListResult,
  TicketReason,
  TicketSource,
  TicketSourceResult,
  TicketSummary,
} from '../../core/src/index.ts';
import {
  buildApprovalListArguments,
  findSupportTemplate,
  getApprovalListCommand,
} from './approval-reading.ts';
import { mustSucceed } from './common.ts';
import type { Run } from './common.ts';
import { classifyDingtalkReason } from './connection-reason.ts';
import { identify } from './identity.ts';
import type { Identity } from './identity.ts';
import { parseExecutedPage, parsePage } from './readonly-page.ts';
import { canReadTickets } from './ticket-options.ts';
import type { TicketReadOptions } from './ticket-options.ts';
import { mergeTicketSummary, projectTicketSummary } from './ticket-projection.ts';
import { createTicketListContext } from './ticket-deadline.ts';

// dws oa +list-pending --help 标明 --start/--end 必填，因此使用一年窗口覆盖较久的待办。
const PENDING_LOOKBACK_DAYS = 365;
const DATED_LOOKBACK_DAYS = 30;
const MILLISECONDS_PER_DAY = 86_400_000;
const TICKET_PAGE_SIZE = 20;
const TICKET_MAX_PAGES_PER_SOURCE = 5;
const TICKET_SOURCES: TicketSource[] = ['pending', 'cc', 'executed'];
type SourceRead = { result: TicketSourceResult; items: TicketSummary[] };
type SourceContext = {
  source: TicketSource;
  run: Run;
  identity: Identity;
  start: number;
  end: number;
};

function mergeItems(items: Map<string, TicketSummary>, incoming: TicketSummary[]): void {
  for (const item of incoming) {
    const existing = items.get(item.id);
    items.set(item.id, existing ? mergeTicketSummary(existing, item) : item);
  }
}

async function readTicketPage(
  context: SourceContext,
  page: number,
): Promise<ReturnType<typeof parsePage>> {
  const args = buildApprovalListArguments({
    source: context.source,
    start: context.start,
    end: context.end,
    profile: context.identity.profile,
    page,
    // 现场环境能稳定读取 20 条；三个来源共用这一页大小，避免超出原生服务实际限制。
    pageSize: TICKET_PAGE_SIZE,
  });
  const envelope = mustSucceed(
    await context.run(args),
    getApprovalListCommand(context.source).join(' '),
  );
  return context.source === 'executed'
    ? parseExecutedPage(envelope, page)
    : parsePage(envelope, page);
}

function projectSourcePage(
  context: SourceContext,
  parsed: ReturnType<typeof parsePage>,
): TicketSummary[] {
  return parsed.instances
    .filter((item) => findSupportTemplate(item) !== undefined)
    .map((payload) =>
      projectTicketSummary({ payload, userId: context.identity.userId, source: context.source }),
    );
}

async function readSource(context: SourceContext): Promise<SourceRead> {
  const result: TicketSourceResult = {
    source: context.source,
    kind: 'success',
    reason: 'none',
    pages: 0,
  };
  const items = new Map<string, TicketSummary>();
  let page = 1;
  for (let index = 0; index < TICKET_MAX_PAGES_PER_SOURCE; index++) {
    try {
      const parsed = await readTicketPage(context, page);
      mergeItems(items, projectSourcePage(context, parsed));
      result.pages++;
      if (parsed.exhausted) return { result, items: [...items.values()] };
      page = parsed.nextPage!;
    } catch (error) {
      result.kind = result.pages > 0 ? 'partial' : 'failure';
      result.reason = classifyDingtalkReason(error);
      return { result, items: [...items.values()] };
    }
  }
  // 即使已读页为空，达到上限也不代表完整读取，必须向页面明确报告。
  result.kind = 'partial';
  result.reason = 'page-limit';
  return { result, items: [...items.values()] };
}

function createListFailure(reason: TicketReason): TicketListResult {
  return createTicketListFailure(
    reason,
    TICKET_SOURCES.map((source) => ({ source, kind: 'failure', reason, pages: 0 })),
  );
}

function combineSources(reads: SourceRead[]): TicketListResult {
  const items = new Map<string, TicketSummary>();
  for (const read of reads) mergeItems(items, read.items);
  const sources = reads.map((read) => read.result);
  const hasSuccessfulPage = sources.some((source) => source.pages > 0);
  const incomplete = sources.find((source) => source.kind !== 'success');
  return {
    kind: !hasSuccessfulPage ? 'failure' : incomplete ? 'partial' : 'success',
    reason: incomplete?.reason ?? 'none',
    items: [...items.values()],
    sources,
  };
}

/**
 * 1. 检查连接；2. 在统一预算内核实身份；3. 仅读取并合并各来源的分页。
 * @param options 连接页选定的账号，以及可替换的执行器、时间和进程依赖。
 * @param resolveIdentity 模块内部可替换身份读取，供共享缓存使用。
 * @returns 成功、部分读取或失败的列表；成功允许为空，失败绝不伪装成空结果。
 * @throws 无；预期环境和接口错误均投影为安全原因类别。
 */
export async function readTicketList(
  options: TicketReadOptions,
  resolveIdentity: typeof identify,
): Promise<TicketListResult> {
  // 1. 没有完成连接时不得启动 CLI，避免悄悄使用默认账号。
  if (!canReadTickets(options.connection)) return createListFailure('connection-required');
  try {
    // 2. 身份校验与业务读取共用关闭日志的 runner，账号信息和内容均不落盘。
    const { run } = createTicketListContext(options);
    const identity = await resolveIdentity(run, options.connection.selectedProfile!);
    const end = (options.now ?? Date.now)();
    // 3. 单来源失败保留其他来源的读取结果，并显式标记部分读取。
    return combineSources(
      await Promise.all(
        TICKET_SOURCES.map((source) => {
          const days = source === 'pending' ? PENDING_LOOKBACK_DAYS : DATED_LOOKBACK_DAYS;
          const start = end - days * MILLISECONDS_PER_DAY;
          return readSource({ source, run, identity, start, end });
        }),
      ),
    );
  } catch (error) {
    return createListFailure(classifyDingtalkReason(error));
  }
}

/**
 * 单次读取待办、抄送和已处理列表；后台连续读取应使用 createTicketReader 共享身份缓存。
 * @param options 连接状态及可替换环境依赖。
 * @returns 分页结果及完整性，不逐张读取详情或猜测处理人。
 * @throws 无；错误转换为安全失败结果。
 */
export function listTickets(options: TicketReadOptions): Promise<TicketListResult> {
  return readTicketList(options, identify);
}
