// 定义允许订阅的审批事件、计数和有界订阅输入输出。
import type { Executable, SpawnFunction } from './runner-types.ts';

/** 只允许观察这四类审批事件，避免订阅无关业务消息。 */
export const OA_EVENT_KEYS = [
  'user_oa_approval_task_created',
  'user_oa_approval_task_finished',
  'user_oa_approval_task_redirected',
  'user_oa_approval_instance_cc',
] as const;

/** 白名单中的单个审批事件名称。 */
export type EventKey = (typeof OA_EVENT_KEYS)[number];

/** 每类审批事件的累计条数，不包含事件正文。 */
export type EventCounts = Record<EventKey, number>;

/** 可注入的计时器接口；句柄由具体时钟实现管理。 */
export type Clock = {
  setTimeout: (callback: () => void, milliseconds: number) => any;
  clearTimeout: (timer: any) => void;
};

/** 有界事件订阅参数，可注入进程、计时器及中止信号。 */
export type ConsumeOptions = {
  eventKeys: string[];
  seconds: number;
  profile?: string;
  logDir?: string;
  spawn?: SpawnFunction;
  executable?: Executable;
  readyTimeoutMs?: number;
  maxOutputBytes?: number;
  clock?: Clock;
  signal?: AbortSignal;
};

/** 订阅运行结果；订阅标识只供内存中的清理核验使用。 */
export type ConsumeResult = {
  ready: boolean;
  counts: EventCounts;
  delivered: boolean;
  normalExit: boolean;
  forcedTermination: boolean;
  readyTimedOut: boolean;
  outputLimitExceeded: boolean;
  malformed: boolean;
  exitCode: number | null;
  subscriptionIds: Set<string>;
};

/** 可打印的事件探针摘要，不包含身份、订阅标识或原始消息。 */
export type EventSummary = {
  ready: boolean;
  counts: EventCounts;
  delivered: boolean;
  normalExit: boolean;
  forcedTermination: boolean;
  readyTimedOut: boolean;
  cleanupVerified: boolean;
  newSubscriptionsCleaned: boolean;
  errorType?: string;
};

/** 事件摘要允许输出的键，包含嵌套计数键及脱敏错误类别。 */
export const EVENT_SUMMARY_KEYS = Object.freeze([
  'ready',
  'counts',
  ...OA_EVENT_KEYS,
  'delivered',
  'normalExit',
  'forcedTermination',
  'readyTimedOut',
  'cleanupVerified',
  'newSubscriptionsCleaned',
  'errorType',
]);

/**
 * 创建全部归零的白名单事件计数。
 * @returns 每类审批事件的零值计数；无预期错误。
 */
export function createEmptyCounts(): EventCounts {
  return Object.fromEntries(OA_EVENT_KEYS.map((key) => [key, 0])) as EventCounts;
}

/**
 * 创建尚未开始订阅的安全摘要。
 * @returns 不含原始业务数据的初始摘要；无预期错误。
 */
export function emptyEventSummary(): EventSummary {
  return {
    ready: false,
    counts: createEmptyCounts(),
    delivered: false,
    normalExit: false,
    forcedTermination: false,
    readyTimedOut: false,
    cleanupVerified: false,
    newSubscriptionsCleaned: false,
  };
}
