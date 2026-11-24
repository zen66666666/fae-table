// 编排事件目录读取、有界订阅及订阅清理核验，只生成脱敏摘要。
import { errorType, isObject } from '../../core/src/index.ts';
import { consumeEvents } from './event-consumer.ts';
import { emptyEventSummary, OA_EVENT_KEYS } from './event-types.ts';
import type { ConsumeOptions, ConsumeResult, EventSummary } from './event-types.ts';
import type { RunnerResult } from './runner-types.ts';

export { EventParser } from './event-parser.ts';
export { consumeEvents } from './event-consumer.ts';
export { emptyEventSummary, EVENT_SUMMARY_KEYS, OA_EVENT_KEYS } from './event-types.ts';
export type {
  ConsumeOptions,
  ConsumeResult,
  EventSummary,
  EventKey,
  EventCounts,
} from './event-types.ts';

/** 事件探针参数，所有钉钉读取均通过受控运行器执行。 */
export type ProbeEventOptions = Omit<ConsumeOptions, 'eventKeys'> & {
  run: (argv: string[]) => Promise<RunnerResult>;
};

/**
 * 从原生事件目录确认四类审批事件均已启用。
 * @param payload CLI 返回的事件目录。
 * @returns 原有顺序的审批事件名称。
 * @throws Error 目录结构不受支持或所需事件不可用。
 */
export function discoverOaEvents(payload: unknown): string[] {
  if (!Array.isArray(payload)) throw new Error('Unsupported event catalog structure');
  const found = new Set(
    payload
      .filter(isObject)
      .filter((event) => event.category === 'oa' && event.status === 'enabled')
      .map((event) => event.event_key),
  );
  if (!OA_EVENT_KEYS.every((key) => found.has(key)))
    throw new Error('Required OA events unavailable');
  return [...OA_EVENT_KEYS];
}

/**
 * 读取仍需保留或核验的订阅标识。
 * @param payload CLI 的订阅状态响应。
 * @returns 尚未明确删除的订阅标识集合。
 * @throws Error 状态结构或订阅条目无效。
 */
export function parseSubscriptionSnapshot(payload: unknown): Set<string> {
  if (
    !isObject(payload) ||
    !isObject(payload.identity) ||
    !isObject(payload.bus) ||
    !Array.isArray(payload.subscriptions)
  ) {
    throw new Error('Unsupported subscription status structure');
  }
  const result = new Set<string>();
  for (const subscription of payload.subscriptions) {
    if (
      !isObject(subscription) ||
      typeof subscription.subscribe_id !== 'string' ||
      !subscription.subscribe_id ||
      typeof subscription.status !== 'string' ||
      !subscription.status
    ) {
      throw new Error('Invalid subscription status item');
    }
    // all 包含已删除条目；只有明确 deleted 才算清理，暂停、错误及未知状态仍算残留。
    if (subscription.status !== 'deleted') result.add(subscription.subscribe_id);
  }
  return result;
}

function parseProbeResponse<T>(
  result: RunnerResult,
  parse: (data: unknown) => T,
  summary: EventSummary,
): T | undefined {
  if (result.kind !== 'success') {
    summary.errorType = errorType(result.error);
    return;
  }
  try {
    return parse(result.data);
  } catch {
    // 成功响应的结构不合约时不能误报为空目录或已清理。
    summary.errorType = errorType({ type: 'structure' });
    return;
  }
}

async function readSnapshot(
  options: ProbeEventOptions,
  profileArgs: string[],
  summary: EventSummary,
): Promise<Set<string> | undefined> {
  try {
    const result = await options.run([
      'event',
      'status',
      '--status',
      'all',
      '-f',
      'json',
      ...profileArgs,
    ]);
    return parseProbeResponse(result, parseSubscriptionSnapshot, summary);
  } catch (error) {
    summary.errorType = errorType(error);
    return;
  }
}

async function readCatalog(
  options: ProbeEventOptions,
  profileArgs: string[],
  summary: EventSummary,
): Promise<string[] | undefined> {
  try {
    const result = await options.run([
      'event',
      'list',
      '--category',
      'oa',
      '-f',
      'json',
      ...profileArgs,
    ]);
    return parseProbeResponse(result, discoverOaEvents, summary);
  } catch (error) {
    summary.errorType = errorType(error);
    return;
  }
}

function applyConsumedSummary(summary: EventSummary, consumed: ConsumeResult): void {
  Object.assign(summary, {
    ready: consumed.ready,
    counts: consumed.counts,
    delivered: consumed.delivered,
    normalExit: consumed.normalExit,
    forcedTermination: consumed.forcedTermination,
    readyTimedOut: consumed.readyTimedOut,
  });
}

/**
 * 读取目录和订阅快照，执行有界订阅并核验新增订阅已清理。
 * @param options 受控运行器、订阅时限及可选进程配置。
 * @returns 脱敏摘要及退出码，读取失败时包含白名单错误类别。
 * @throws Error 订阅参数、资源配置或进程启动失败。
 */
export async function probeEvents(
  options: ProbeEventOptions,
): Promise<{ summary: EventSummary; exitCode: number }> {
  const summary = emptyEventSummary();
  const profileArgs = options.profile ? ['--profile', options.profile] : [];
  const keys = await readCatalog(options, profileArgs, summary);
  if (!keys) return { summary, exitCode: 1 };
  const beforeIds = await readSnapshot(options, profileArgs, summary);
  if (!beforeIds) return { summary, exitCode: 1 };
  const consumed = await consumeEvents({ ...options, eventKeys: keys });
  applyConsumedSummary(summary, consumed);
  const afterIds = await readSnapshot(options, profileArgs, summary);
  if (afterIds) {
    const owned = [...consumed.subscriptionIds].filter((id) => !beforeIds.has(id));
    // 每项新订阅都必须得到明确标识，不能把未识别到标识当作零残留。
    summary.cleanupVerified = consumed.subscriptionIds.size === keys.length;
    summary.newSubscriptionsCleaned =
      summary.cleanupVerified && owned.every((id) => !afterIds.has(id));
  }
  const isSuccessful =
    summary.ready &&
    summary.normalExit &&
    summary.cleanupVerified &&
    summary.newSubscriptionsCleaned;
  return { summary, exitCode: isSuccessful ? 0 : 1 };
}
