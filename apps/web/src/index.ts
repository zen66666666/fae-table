// 工作台网页模块：App 展示首次设置及三栏单据工作台；createWorkbenchClient 封装固定同源接口。
// 浏览器入口使用 App，宿主可替换客户端和计时器以复用页面。
export { App } from './app.tsx';
export type { AppProps } from './app.tsx';
export { createWorkbenchClient } from './api-client.ts';
export type { WorkbenchClient } from './api-client.ts';
