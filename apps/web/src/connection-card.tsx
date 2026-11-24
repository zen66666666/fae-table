// 提供连接卡片的公共标题、状态与内容容器，供各业务卡片复用。
import type { ReactElement, ReactNode } from 'react';
import type { ConnectionState } from '../../../packages/core/src/index.ts';
import type { SettingsSection } from './setup-navigation.tsx';
import { StatusTag } from './status-tag.tsx';

/** 连接卡片输入，业务内容由子组件提供。 */
export type ConnectionCardProps = {
  kind: SettingsSection;
  title: string;
  description: string;
  state: ConnectionState;
  footer?: ReactNode;
  children: ReactNode;
};

/**
 * 渲染具有统一结构的连接卡片。
 * @param props 标题、说明、状态及具体业务内容。
 * @returns 带可访问标题的卡片区域。
 * @throws 无预期错误。
 */
export function ConnectionCard({
  kind,
  title,
  description,
  state,
  footer,
  children,
}: ConnectionCardProps): ReactElement {
  return (
    <section className="connection-card" aria-labelledby={`${kind}-title`}>
      <div className="card-topline">
        <div>
          <h2 id={`${kind}-title`}>{title}</h2>
          <p className="card-description">{description}</p>
        </div>
        <StatusTag state={state === 'failed' ? 'action-required' : state} />
      </div>
      <div className="card-content">{children}</div>
      {footer && <footer className="setup-card-footer">{footer}</footer>}
    </section>
  );
}
