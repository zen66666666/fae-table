// 自动调整多行输入框高度，供中栏回复和右栏 AI 提问共用。
import type { ReactElement, Ref, TextareaHTMLAttributes } from 'react';

const INITIAL_ROWS = 2;

/** 输入元素的现有属性，以及外层尺寸样式和受控文本。 */
export type GrowingTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'className' | 'rows' | 'value'
> & { className: string; value: string; inputRef?: Ref<HTMLTextAreaElement> };

/**
 * 用同尺寸的隐藏文本决定输入框高度，保留原生键盘和滚动行为。
 * @param props 受控文本、输入属性和承载尺寸变量的样式名。
 * @returns 随文本展开的多行输入框。
 * @throws 无预期错误。
 */
export function GrowingTextarea({
  className,
  value,
  inputRef,
  ...input
}: GrowingTextareaProps): ReactElement {
  return (
    <div className={`growing-textarea ${className}`} data-value={value}>
      <textarea {...input} ref={inputRef} rows={INITIAL_ROWS} value={value} />
    </div>
  );
}
