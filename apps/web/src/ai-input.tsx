// 提供带可见标签的输入框，供 AI 接口表单复用。
import { useId } from 'react';
import type { InputHTMLAttributes, ReactElement } from 'react';

/** AI 表单字段的可见标签和原生输入属性。 */
export type AiInputProps = InputHTMLAttributes<HTMLInputElement> & { label: string };

/**
 * 使用稳定标识关联输入和标签，并关闭文本自动纠正。
 * @param props 可见标签和值、类型等输入属性。
 * @returns 一个标记清晰的表单字段。
 * @throws 无预期错误。
 */
export function AiInput({ label, ...input }: AiInputProps): ReactElement {
  const id = useId();
  return (
    <label className="ai-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} autoComplete="off" spellCheck={false} {...input} />
    </label>
  );
}
