// 组合手填模型和对话测试控件，供 AI 设置在名单不足时使用。
import type { ReactElement } from 'react';
import { AI_COPY, AI_TEST_LABELS } from './ai-copy.ts';
import { AiInput } from './ai-input.tsx';
import { Button } from './button.tsx';
import type { AiFormState } from './use-ai-form.ts';

/** 模型草稿、手动输入标签和打开该输入的原因。 */
export type AiManualModelFieldsProps = { form: AiFormState; label: string; message: string };

/**
 * 提供手填模型的输入和实际对话测试，使用试验结果启用保存。
 * @param props 当前设置草稿和界面提示。
 * @returns 模型输入、测试按钮与结果。
 * @throws 无预期错误；失败由状态文案展示。
 */
export function AiManualModelFields({
  form,
  label,
  message,
}: AiManualModelFieldsProps): ReactElement {
  const { canTest, config, isManualModel, isTesting, operation, test, updateModel } = form;
  const resultLabel = test ? AI_TEST_LABELS[test.kind] : AI_COPY.notTested;
  return (
    <div className="ai-model-picker">
      <p className="inline-message" role="status">
        {message}
      </p>
      <AiInput
        label={label}
        value={isManualModel ? config.model : ''}
        disabled={operation.isPending}
        onChange={(event) => updateModel({ value: event.currentTarget.value, isManual: true })}
      />
      <div className="setup-actions">
        <Button
          disabled={operation.isPending || !canTest}
          onClick={() => void operation.run('test')}
        >
          {AI_COPY.test}
        </Button>
      </div>
      <p className="ai-test-result" role="status" data-result={test?.kind}>
        <span>{AI_COPY.testResult}</span>
        <strong>{isTesting ? AI_COPY.testing : resultLabel}</strong>
      </p>
    </div>
  );
}
