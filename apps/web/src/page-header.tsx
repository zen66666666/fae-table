// 呈现设置页标题和状态刷新入口，供首次设置和手动设置复用。
import type { ReactElement } from 'react';
import { Button } from './button.tsx';
import { COPY } from './copy.ts';

/** 页面顶部的设置标题与刷新操作。 */
export type PageHeaderProps = {
  title: string;
  isChecking: boolean;
  onRefresh: () => Promise<void>;
};

/**
 * 展示当前设置模式和刷新按钮。
 * @param props 页面标题、刷新状态和执行回调。
 * @returns 页面顶部区域。
 * @throws 无预期错误。
 */
export function PageHeader({ title, isChecking, onRefresh }: PageHeaderProps): ReactElement {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      <Button
        className="refresh-button"
        disabled={isChecking}
        onClick={() => {
          void onRefresh();
        }}
      >
        {isChecking ? COPY.refreshing : COPY.refresh}
      </Button>
    </div>
  );
}
