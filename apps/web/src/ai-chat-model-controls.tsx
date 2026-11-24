// 在 AI 助手标题展示当前模型、切换与刷新，缺少列表时链接到连接设置。
import type { ReactElement } from 'react';
import { AI_CHAT_COPY } from './ai-chat-copy.ts';
import { AI_COPY } from './ai-copy.ts';
import { AiModelPicker } from './ai-model-picker.tsx';
import { Button } from './button.tsx';
import { REASON_DETAILS } from './copy.ts';
import type { AiModelControls } from './use-ai-model-controls.ts';

/** 右栏模型状态、正在生成标记和连接设置入口。 */
export type AiChatModelControlsProps = {
  controls: AiModelControls;
  isGenerating: boolean;
  onSettings: () => void;
};

/**
 * 使用已保存列表切换整个工作台当前模型，回答期间锁定操作。
 * @param props 受控的模型切换状态、是否正在生成和设置入口。
 * @returns 模型选择器，或当前模型名称与设置入口。
 * @throws 无预期错误。
 */
export function AiChatModelControls({
  controls,
  isGenerating,
  onSettings,
}: AiChatModelControlsProps): ReactElement | null {
  const {
    model,
    models,
    isModelListTruncated,
    isPending,
    isAnswering,
    message,
    reason,
    select,
    refresh,
  } = controls;
  if (!model && !models.length) return null;
  const isBusy = isGenerating || isAnswering;
  const isDisabled = isPending || isBusy;
  const actionFeedback = reason === 'none' ? message : REASON_DETAILS[reason].label;
  const feedback = isBusy ? AI_CHAT_COPY.modelsBusy : actionFeedback;
  return (
    <div className="ai-chat-model" data-has-list={Boolean(models.length)}>
      {models.length ? (
        <AiModelPicker
          models={models}
          model={model}
          isCompact
          listHint={isModelListTruncated ? AI_COPY.truncatedWorkbenchModels : undefined}
          isDisabled={isDisabled}
          onSelect={select}
          onRefresh={refresh}
        />
      ) : (
        <>
          <span className="ai-chat-model-name" title={model}>
            {model}
          </span>
          <Button variant="quiet" size="small" disabled={isDisabled} onClick={onSettings}>
            {AI_COPY.changeModelInSettings}
          </Button>
        </>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </div>
  );
}
