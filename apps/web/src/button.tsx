// 提供准备页统一的按钮外观与禁用行为，供各卡片及页面操作复用。
import type { ButtonHTMLAttributes, ReactElement } from 'react';

/** 原生按钮属性、共用动作样式及两种尺寸。 */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'approve' | 'reject' | 'reject-solid';
  size?: 'small' | 'default';
};

/**
 * 渲染统一按钮，默认不会触发表单提交。
 * @param props 按钮属性、样式等级及内容。
 * @returns 可聚焦、可禁用的按钮元素。
 * @throws 无预期错误。
 */
export function Button({
  variant = 'secondary',
  size = 'default',
  className = '',
  type = 'button',
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      className={`button button--${variant} button--${size} ${className}`}
      {...props}
    />
  );
}
