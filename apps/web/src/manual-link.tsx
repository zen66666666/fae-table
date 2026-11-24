// 提供经过校验的本机或官网链接，供单据手册区复用。
import type { ReactElement } from 'react';

/** 受信的后台地址和用户可识别的链接文案。 */
export type ManualLinkProps = { href: string; label: string; accessibleLabel?: string };

/**
 * 在新页面打开本机手册或官网页面，并隔离工作台窗口和来源。
 * @param props 同源文件地址或已校验官网地址，以及固定文案。
 * @returns 安全属性齐备的链接。
 * @throws 无预期错误。
 */
export function ManualLink({ href, label, accessibleLabel }: ManualLinkProps): ReactElement {
  return (
    <a
      className="manual-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={accessibleLabel}
    >
      {label}
    </a>
  );
}
