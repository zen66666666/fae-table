// 统一单据时间的本机时区显示、等待时长和更新时间文案，不推测缺失或无效时间。
import { TICKET_COPY } from './ticket-copy.ts';

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function readElapsed(time: string | null, now: number): number | null {
  if (!time) return null;
  const timestamp = Date.parse(time);
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : null;
}

function formatTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function formatMonthDay(date: Date): string {
  return `${formatTwoDigits(date.getMonth() + 1)}-${formatTwoDigits(date.getDate())}`;
}

function formatYear(date: Date): string {
  return String(date.getFullYear()).padStart(4, '0');
}

function parseLocalDate(time: string | null): Date | null {
  if (!time) return null;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatClock(date: Date): string {
  return `${formatTwoDigits(date.getHours())}:${formatTwoDigits(date.getMinutes())}`;
}

/**
 * 把带时间的下载记录按本机日历显示为月日。
 * @param time 后台记录的下载时间。
 * @returns MM-dd；无效时间显示占位符。
 * @throws 无预期错误。
 */
export function formatTicketDate(time: string): string {
  const date = parseLocalDate(time);
  return date ? formatMonthDay(date) : TICKET_COPY.placeholder;
}

/**
 * 把后台的计划时间显示为左栏刷新倒计时。
 * @param options 下一次刷新时刻及可替换的当前毫秒时间。
 * @returns 分钟和秒的剩余时间，到时显示正在刷新，无计划时返回 null。
 * @throws 无预期错误。
 */
export function formatTicketRefreshCountdown(options: {
  time: string | null;
  now: number;
}): string | null {
  const { time, now } = options;
  const date = parseLocalDate(time);
  if (!date || !Number.isFinite(now)) return null;
  const seconds = Math.ceil((date.getTime() - now) / SECOND_MS);
  if (seconds <= 0) return TICKET_COPY.refreshingBackground;
  const secondsPerMinute = MINUTE_MS / SECOND_MS;
  return TICKET_COPY.formatNextRefresh(
    Math.floor(seconds / secondsPerMinute),
    seconds % secondsPerMinute,
  );
}

/**
 * 按浏览器本机时区显示单据时间，与页面注入的当前时间比较日期和年份。
 * @param options 后台时间及页面共用的当前时间，now 单位为毫秒。
 * @returns 今天显示“今天 HH:mm”，同年显示“MM-dd HH:mm”，其他年份显示“yyyy-MM-dd HH:mm”；无效时为占位符。
 * @throws 无；缺失时间或无效日期均不参与格式化。
 */
export function formatTicketTime(options: { time: string | null; now: number }): string {
  const date = parseLocalDate(options.time);
  const current = new Date(options.now);
  if (!date || !Number.isFinite(current.getTime())) {
    return TICKET_COPY.placeholder;
  }
  const clock = formatClock(date);
  // 日期比较与显示都使用本机日历，不能按 ISO 的 UTC 日期截取，否则跨日、跨年会错位。
  const isSameYear = date.getFullYear() === current.getFullYear();
  const isToday =
    isSameYear && date.getMonth() === current.getMonth() && date.getDate() === current.getDate();
  if (isToday) return `${TICKET_COPY.today} ${clock}`;
  const year = isSameYear ? '' : `${formatYear(date)}-`;
  return `${year}${formatMonthDay(date)} ${clock}`;
}

/**
 * 将发起时间显示为已经等待的时长。
 * @param options 后台发起时间、可替换的当前毫秒时间和是否仅显示天数。
 * @returns 天、小时、分钟的等待文案；缺少时间时显示占位符。
 * @throws 无。
 */
export function formatTicketWait(options: {
  createdAt: string | null;
  now: number;
  isDaysOnly?: boolean;
}): string {
  const elapsed = readElapsed(options.createdAt, options.now);
  if (elapsed === null) return TICKET_COPY.unknownWait;
  if (options.isDaysOnly || elapsed >= DAY_MS)
    return `${TICKET_COPY.waitPrefix}${Math.floor(elapsed / DAY_MS)}${TICKET_COPY.days}`;
  if (elapsed >= HOUR_MS)
    return `${TICKET_COPY.waitPrefix}${Math.floor(elapsed / HOUR_MS)}${TICKET_COPY.hours}`;
  return `${TICKET_COPY.waitPrefix}${Math.floor(elapsed / MINUTE_MS)}${TICKET_COPY.minutes}`;
}

/**
 * 将列表或详情的读取时间显示为距今多久。
 * @param options 后台读取时间、可替换当前时间（单位毫秒）和可选显示文案。
 * @returns 距今分钟数或尚未更新文案。
 * @throws 无。
 */
export function formatTicketUpdate(options: {
  updatedAt: string | null;
  now: number;
  copy?: { missing: string; minutesAgo: string };
}): string {
  const elapsed = readElapsed(options.updatedAt, options.now);
  return elapsed === null
    ? (options.copy?.missing ?? TICKET_COPY.notUpdated)
    : `${Math.floor(elapsed / MINUTE_MS)}${options.copy?.minutesAgo ?? TICKET_COPY.updatedMinutesAgo}`;
}
