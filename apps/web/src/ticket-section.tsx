// 提供详情中各个只读信息区块的统一结构，由表单、附件、记录和任务区域复用。
import type { ReactElement, ReactNode } from 'react';

/** 详情区块的标题、正文及可选标题动作。 */
export type TicketSectionProps = { title: string; children: ReactNode; action?: ReactNode };

/**
 * 渲染带标题的信息区块，避免详情页面重复边框和间距结构。
 * @param props 区块标题、内容和可选控制按钮。
 * @returns 详情区块。
 * @throws 无预期错误。
 */
export function TicketSection({ title, children, action }: TicketSectionProps): ReactElement {
  const heading = <h2>{title}</h2>;
  return (
    <section className="ticket-section">
      {action ? (
        <div className="ticket-section-heading">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}
