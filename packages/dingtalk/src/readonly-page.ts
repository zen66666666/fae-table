// 校验审批分页协议并按边界读取待处理与抄送列表。
import { AppError, asObject, errorType, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { mustSucceed } from './common.ts';
import type { Run } from './common.ts';
import { buildApprovalListArguments, findSupportTemplate } from './approval-reading.ts';
import type {
  Candidate,
  Instance,
  Options,
  ProbeProgress,
  SourceSummary,
} from './readonly-types.ts';

type ParsedPage = { instances: Instance[]; exhausted: boolean; nextPage?: number };
type SourceContext = {
  source: 'pending' | 'cc';
  target: SourceSummary;
  candidates: Candidate[];
  seen: Set<string>;
  progress: ProbeProgress;
  start: number;
  end: number;
};

/**
 * 校验列表数据、完整性标记与下一页令牌的一致性。
 * @param envelope CLI 返回的完整对象。
 * @param page 当前页码。
 * @returns 已校验的实例列表与分页状态。
 * @throws AppError 数据结构或分页令牌不符合协议时抛出。
 */
export function parsePage(envelope: JsonObject, page: number): ParsedPage {
  const data = asObject(envelope.data);
  const pagination = asObject(asObject(envelope.meta).pagination);
  const instances = data.instances;
  if (
    !Array.isArray(instances) ||
    !instances.every(
      (instance) =>
        isObject(instance) &&
        typeof instance.processInstanceId === 'string' &&
        instance.processInstanceId.length > 0,
    ) ||
    data.count !== instances.length ||
    typeof data.complete !== 'boolean' ||
    typeof pagination.endpoint_exhausted !== 'boolean' ||
    data.complete !== pagination.endpoint_exhausted
  ) {
    throw new AppError('structure', 'invalid_list_page', 'list');
  }
  const isExhausted = pagination.endpoint_exhausted;
  const token = pagination.next_token;
  if (isExhausted && token !== undefined && token !== null && token !== '') {
    throw new AppError('structure', 'conflicting_pagination', 'list');
  }
  // 只接受严格前进的页码，防止错误游标造成重复读取或无限循环。
  if (
    !isExhausted &&
    (typeof token !== 'string' ||
      !/^[1-9]\d*$/.test(token) ||
      !Number.isSafeInteger(Number(token)) ||
      Number(token) <= page)
  ) {
    throw new AppError('structure', 'missing_continuation', 'list');
  }
  return {
    instances: instances as Instance[],
    exhausted: isExhausted,
    ...(!isExhausted ? { nextPage: Number(token) } : {}),
  };
}

/**
 * 将我已处理列表的原生结构转换后交给统一分页校验。
 * @param envelope CLI 已判定成功的原生列表响应。
 * @param page 当前请求的页码。
 * @returns 已校验的实例列表和完整性状态。
 * @throws AppError 未返回结果集合或明确的分页状态时抛出。
 */
export function parseExecutedPage(envelope: JsonObject, page: number): ParsedPage {
  // 1. 校验原生分页标记。2. 映射查询来源不同的两个字段。3. 由共用校验推进页码。
  const { hasMore, values } = asObject(envelope.result); // 1.
  if (!Array.isArray(values) || typeof hasMore !== 'boolean') {
    throw new AppError('structure', 'invalid_executed_page', 'list');
  }
  const instances = values.map(
    (
      value, // 2.
    ) =>
      isObject(value)
        ? { ...value, createTime: value.processCreateTime, originatorUserid: value.originatorId }
        : value,
  );
  // 3. 原生接口没有游标，只有明确的 hasMore=false 才算读完整。
  const complete = !hasMore;
  const pagination = {
    endpoint_exhausted: complete,
    next_token: hasMore ? String(page + 1) : null,
  };
  return parsePage(
    { data: { instances, count: instances.length, complete }, meta: { pagination } },
    page,
  );
}

function recordPage(context: SourceContext, result: ParsedPage, page: number): void {
  context.target.pages.push({
    page,
    success: true,
    count: result.instances.length,
    hasMore: !result.exhausted,
    endpointExhausted: result.exhausted,
    ...(result.nextPage !== undefined ? { nextPage: result.nextPage } : {}),
  });
  context.target.count += result.instances.length;
  context.progress.goodCount++;
  for (const instance of result.instances) {
    const name = findSupportTemplate(instance);
    if (name && !context.seen.has(instance.processInstanceId)) {
      context.candidates.push({ name, instance });
      context.seen.add(instance.processInstanceId);
    }
  }
}

async function readSource(
  run: Run,
  profile: string,
  options: Options,
  context: SourceContext,
): Promise<void> {
  let page = 1;
  for (let index = 0; index < options.maxPages; index++) {
    try {
      const args = buildApprovalListArguments({
        source: context.source,
        start: context.start,
        end: context.end,
        profile,
        page,
        pageSize: options.pageSize,
      });
      const result = parsePage(mustSucceed(await run(args), `oa +list-${context.source}`), page);
      recordPage(context, result, page);
      if (result.exhausted) break;
      if (index === options.maxPages - 1) {
        context.target.maxPagesReached = true;
        context.target.incomplete = true;
        context.progress.isIncomplete = true;
      }
      page = result.nextPage!;
    } catch (error) {
      context.target.pages.push({ page, success: false, errorType: errorType(error) });
      context.target.incomplete = true;
      context.progress.isIncomplete = true;
      break;
    }
  }
}

/**
 * 按相同时间范围读取两类列表并收集去重后的支持流程候选。
 * @param run 经过白名单校验的执行器。
 * @param profile 已核实的钉钉身份。
 * @param options 查询时间范围与分页上限。
 * @param summary 接收分页结果的摘要对象。
 * @param progress 接收成功调用次数与未完整读取状态。
 * @returns 保持列表出现顺序的候选实例。
 * @throws 无；单页读取与时间格式错误均写入摘要。
 */
export async function collectSources(
  run: Run,
  profile: string,
  options: Options,
  summary: JsonObject,
  progress: ProbeProgress,
): Promise<Candidate[]> {
  const end = options.now ?? Date.now();
  const start = end - options.days * 86_400_000;
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const source of ['pending', 'cc'] as const) {
    await readSource(run, profile, options, {
      source,
      target: summary[source] as SourceSummary,
      candidates,
      seen,
      progress,
      start,
      end,
    });
  }
  return candidates;
}
