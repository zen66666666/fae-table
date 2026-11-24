// 集中定义暂时性故障的退避节奏，供后台刷新和资料下载共用。

const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000] as const;

/**
 * 计算连续暂时性失败后的等待时间，成功后的失败计数由调用方清零。
 * @param options 连续失败次数（第一次为 1）及正常刷新间隔。
 * @returns 当前退避间隔，最多等待正常刷新间隔。
 * @throws 无预期错误。
 */
export function getRetryDelay(options: { failureCount: number; maxDelayMs: number }): number {
  const index = Math.min(Math.max(options.failureCount - 1, 0), RETRY_DELAYS_MS.length - 1);
  return Math.min(RETRY_DELAYS_MS[index], options.maxDelayMs);
}
