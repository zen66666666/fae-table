// 将 AI 接口设置和测试反馈组合为连接卡片，供首次向导与手动设置使用。
import type { ReactElement } from 'react';
import { AI_COPY } from './ai-copy.ts';
import { AiFormFields } from './ai-form-fields.tsx';
import { AiModelFields } from './ai-model-fields.tsx';
import { getAiConnectionState } from './ai-status.ts';
import { Button } from './button.tsx';
import { ConnectionCard } from './connection-card.tsx';
import { COPY } from './copy.ts';
import { ReasonNotice } from './reason-notice.tsx';
import { SetupCardActions } from './setup-card-actions.tsx';
import type { SetupCardActionsProps } from './setup-card-actions.tsx';
import { useAiForm } from './use-ai-form.ts';
import type { AiFormOptions } from './use-ai-form.ts';

/**
 * 展示 AI 配置，取得模型选择或手动测试结果后才保存。
 * @param options 配置摘要、受控操作及向导下一步回调。
 * @returns AI 接口连接卡片。
 * @throws 无预期错误；请求错误由固定的原因提示展示。
 */
export function AiCard(
  options: AiFormOptions & { navigation: SetupCardActionsProps },
): ReactElement {
  const form = useAiForm(options);
  const { operation, canEnterModel, canSave, canFetchModels, isFetchingModels, isTesting } = form;
  const savedModel = options.status?.model;
  return (
    <ConnectionCard
      kind="ai"
      title={AI_COPY.title}
      description={AI_COPY.description}
      state={isFetchingModels || isTesting ? 'checking' : getAiConnectionState(options.status)}
      footer={
        <SetupCardActions {...options.navigation}>
          {options.status?.isConfigured && !options.onContinue && (
            <Button
              variant="quiet"
              disabled={operation.isPending}
              onClick={() => void operation.run('clear')}
            >
              {AI_COPY.clear}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={operation.isPending || !canSave}
            onClick={() => void operation.run('save')}
          >
            {options.onContinue ? COPY.nextStep : AI_COPY.save}
          </Button>
        </SetupCardActions>
      }
    >
      <form
        className="ai-form"
        onSubmit={(event) => {
          event.preventDefault();
          void operation.run(canEnterModel ? 'test' : 'models');
        }}
      >
        {savedModel && (
          <p className="metadata ai-current-model">
            {AI_COPY.currentModel}
            <span>{savedModel}</span>
          </p>
        )}
        <AiFormFields status={options.status} form={form} />
        <div className="setup-actions">
          <Button
            disabled={operation.isPending || !canFetchModels}
            onClick={() => void operation.run('models')}
          >
            {isFetchingModels ? AI_COPY.fetchingModels : AI_COPY.fetchModels}
          </Button>
        </div>
        <AiModelFields form={form} />
        <ReasonNotice reason={operation.reason} />
      </form>
    </ConnectionCard>
  );
}
