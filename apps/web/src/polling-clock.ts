// 统一浏览器轮询计时器的可替换契约，供连接状态和单据快照共同使用。

/** 轮询时钟；宿主可替换定时和取消实现，不依赖浏览器真实时间。 */
export type PollingClock = {
  setInterval: (callback: () => void, milliseconds: number) => ReturnType<typeof setInterval>;
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
};

/** 默认轮询计时器；包装原生调用以免浏览器把普通对象误认为计时器接收者。 */
export const BROWSER_POLLING_CLOCK: PollingClock = {
  setInterval: (callback, milliseconds) => setInterval(callback, milliseconds),
  clearInterval: (timer) => clearInterval(timer),
};
