// 定时读取本机快照或时钟，供列表和右栏资料共用。
import { useEffect } from 'react';
import { BROWSER_POLLING_CLOCK } from './polling-clock.ts';
import type { PollingClock } from './polling-clock.ts';

/** 快照轮询的读取动作、周期、开关和可替换时钟。 */
export type TicketPollingOptions = {
  reload: () => void | Promise<void>;
  intervalMs: number;
  isEnabled?: boolean;
  clock?: PollingClock;
  notBefore?: number;
  now?: () => number;
};

/**
 * 在启用期间定时取本机快照，暂停或离开页面时清理定时器。
 * @param options 读取动作、周期、启用条件、可选截止时间及可替换时钟。
 * @returns 无返回值。
 * @throws 无预期错误；请求错误由调用方读取动作处理。
 */
export function useTicketPolling(options: TicketPollingOptions): void {
  const {
    reload,
    intervalMs,
    isEnabled = true,
    clock = BROWSER_POLLING_CLOCK,
    notBefore,
    now = Date.now,
  } = options;
  useEffect(() => {
    if (!isEnabled) return;
    const timer = clock.setInterval(() => {
      // 官网暂时失败时，等待后台给出的重试时间，避免在退避期间重复请求。
      if (notBefore === undefined || now() >= notBefore) void reload();
    }, intervalMs);
    return () => clock.clearInterval(timer);
  }, [clock, intervalMs, isEnabled, notBefore, now, reload]);
}
