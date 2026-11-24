// 集中定义三栏工作台的列表轮询周期，供单据页面组件使用。

/** 网页读取后台列表快照的周期，单位毫秒；此请求不等待钉钉命令。 */
export const TICKET_POLL_INTERVAL_MS = 10_000;
/** 左栏倒计时采样本机时钟的周期，单位毫秒。 */
export const TICKET_COUNTDOWN_INTERVAL_MS = 1_000;
