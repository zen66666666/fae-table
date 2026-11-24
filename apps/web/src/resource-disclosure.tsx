// 在右栏显示单行资料摘要及展开入口，供手册与研发人员区复用。
import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './button.tsx';
import { useResourcePreference } from './use-resource-preference.ts';
import type { GetResourcePreferenceStorage } from './use-resource-preference.ts';

const RESOURCE_DISCLOSURE_COPY = { expand: '展开', collapse: '收起' } as const;

/** 单行摘要、可选快捷操作和独立的浏览器偏好。 */
export type ResourceDisclosureProps = {
  title: string;
  summary: string;
  action?: ReactNode;
  preferenceKey: string;
  getStorage?: GetResourcePreferenceStorage;
  children: ReactNode;
};

/**
 * 呈现一条始终可见的资料摘要，将详细内容放在同一项的可折叠区域。
 * @param props 摘要、详情、快捷操作和可替换的偏好存储。
 * @returns 带无障碍展开状态的资料条目。
 * @throws 无预期错误；无法保存偏好时仍可临时展开。
 */
export function ResourceDisclosure(props: ResourceDisclosureProps): ReactElement {
  const { title, summary, action, preferenceKey, getStorage, children } = props;
  const { isExpanded, toggle } = useResourcePreference({ key: preferenceKey, getStorage });
  const detailsId = useId();
  const toggleLabel = isExpanded
    ? RESOURCE_DISCLOSURE_COPY.collapse
    : RESOURCE_DISCLOSURE_COPY.expand;
  const toggleProps = {
    'aria-controls': detailsId,
    'aria-expanded': isExpanded,
    'aria-label': `${toggleLabel}${title}`,
    onClick: toggle,
  };
  const label = (
    <>
      <strong>{title}</strong>
      <span className="resource-summary-text" title={summary}>
        {summary}
      </span>
    </>
  );
  return (
    <section className="resource-entry">
      <div className="resource-summary">
        {action ? (
          <>
            <Button
              className="resource-summary-toggle"
              variant="quiet"
              size="small"
              {...toggleProps}
            >
              {label}
              <span className="resource-toggle-chevron" aria-hidden="true" />
            </Button>
            {action}
          </>
        ) : (
          <>
            {label}
            <Button className="resource-disclosure" variant="quiet" size="small" {...toggleProps}>
              {toggleLabel}
            </Button>
          </>
        )}
      </div>
      <div id={detailsId} className="resource-details" hidden={!isExpanded}>
        {children}
      </div>
    </section>
  );
}
