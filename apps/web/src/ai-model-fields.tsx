// 展示模型选择或手动测试，让 AI 接口卡片只组合页内流程。
import type { ReactElement } from 'react';
import { AI_COPY, getAiModelsMessage } from './ai-copy.ts';
import { AiManualModelFields } from './ai-manual-model-fields.tsx';
import { AiModelPicker } from './ai-model-picker.tsx';
import type { AiFormState } from './use-ai-form.ts';

/** 模型发现结果、草稿选择与对应操作。 */
export type AiModelFieldsProps = { form: AiFormState };

/**
 * 成功时提供模型选择，列表截断、不受支持或获取失败时提供手动模型测试。
 * @param props AI 草稿及受控操作。
 * @returns 模型控件、固定结果提示或空内容。
 * @throws 无预期错误。
 */
export function AiModelFields({ form }: AiModelFieldsProps): ReactElement | null {
  const { models, config, isManualModel, updateModel, operation } = form;
  if (!models) return null;
  if (models.kind === 'available') {
    return (
      <>
        {!models.models.length && (
          <p className="inline-message" role="status">
            {AI_COPY.noModels}
          </p>
        )}
        <AiModelPicker
          models={models.models}
          model={isManualModel ? '' : config.model}
          isDisabled={operation.isPending || !models.models.length}
          onSelect={(value) => updateModel({ value, isManual: false })}
        />
        {models.isTruncated && (
          <AiManualModelFields
            form={form}
            label={AI_COPY.manualModel}
            message={AI_COPY.truncatedModels}
          />
        )}
      </>
    );
  }
  const message =
    models.kind === 'request-failed' ? AI_COPY.fetchModelsFailed : getAiModelsMessage(models);
  return <AiManualModelFields form={form} label={AI_COPY.model} message={message} />;
}
