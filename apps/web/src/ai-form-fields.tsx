// 渲染 AI 地址、Key 以及已保存凭据摘要，供 AI 接口卡片使用。
import type { ReactElement } from 'react';
import { getAiAddress } from '../../../packages/core/src/index.ts';
import type { AiStatus } from '../../../packages/core/src/index.ts';
import { AI_COPY } from './ai-copy.ts';
import { AiInput } from './ai-input.tsx';
import { Button } from './button.tsx';
import type { AiFormState } from './use-ai-form.ts';

/** AI 接口凭据输入组的配置摘要和受控表单状态。 */
export type AiFormFieldsProps = { status: AiStatus | null; form: AiFormState };

/**
 * 展示接口地址与对应的凭据，应重新填写 Key 时显示输入框。
 * @param props 已脱敏状态和当前表单。
 * @returns 地址、Key 及各自的安全提示。
 * @throws 无预期错误。
 */
export function AiFormFields({ status, form }: AiFormFieldsProps): ReactElement {
  const { config, hasChangedServer, isEditingKey, operation, toggleKeyEditing, updateField } = form;
  const savedKey = status?.keyLastFour
    ? `${AI_COPY.keySaved}（${AI_COPY.keySuffix} ${status.keyLastFour}）`
    : AI_COPY.keySaved;
  return (
    <>
      <div className="ai-address-field">
        <AiInput
          label={AI_COPY.address}
          inputMode="url"
          placeholder={AI_COPY.addressExample}
          value={config.address}
          disabled={operation.isPending}
          onChange={(event) => updateField('address', event.currentTarget.value)}
        />
        {getAiAddress(config.address)?.protocol === 'http:' && (
          <p className="ai-unencrypted" role="status">
            {AI_COPY.unencrypted}
          </p>
        )}
      </div>
      {hasChangedServer && (
        <p className="inline-message" role="status">
          {AI_COPY.changedServer}
        </p>
      )}
      {isEditingKey && (
        <AiInput
          label={AI_COPY.key}
          type="password"
          required
          value={config.apiKey}
          disabled={operation.isPending}
          onChange={(event) => updateField('apiKey', event.currentTarget.value)}
        />
      )}
      {status?.isConfigured && !hasChangedServer && (
        <div className="ai-saved-key">
          <p className="metadata">
            {AI_COPY.key}
            <span>{savedKey}</span>
          </p>
          <Button variant="quiet" disabled={operation.isPending} onClick={toggleKeyEditing}>
            {isEditingKey ? AI_COPY.cancelKeyChange : AI_COPY.changeKey}
          </Button>
        </div>
      )}
    </>
  );
}
