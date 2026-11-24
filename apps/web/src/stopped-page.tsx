// 在本机服务成功退出后显示明确的结束状态，供页面组件使用。
import type { ReactElement } from 'react';
import { COPY } from './copy.ts';

/**
 * 展示后台已停止的页面，避免继续发起连接请求。
 * @returns 退出完成提示。
 * @throws 无预期错误。
 */
export function StoppedPage(): ReactElement {
  return (
    <main className="stopped-page">
      <span className="stopped-symbol" aria-hidden="true">
        ✓
      </span>
      <h1>{COPY.stoppedTitle}</h1>
      <p>{COPY.stoppedDescription}</p>
    </main>
  );
}
