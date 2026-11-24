// 编排模型查询、手动连通测试及保存，供 AI 接口卡片使用。
import { useState } from 'react';
import { isAiModel } from '../../../packages/core/src/index.ts';
import type { AiStatus } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import { useAiDraft } from './use-ai-draft.ts';
import type { AiDraft } from './use-ai-draft.ts';
import { useRequestAction } from './use-request-action.ts';
import type { RequestAction } from './use-request-action.ts';

type AiOperation = 'models' | 'test' | 'save' | 'clear';

/** AI 接口表单的公开配置、同源客户端和动作回调。 */
export type AiFormOptions = {
  status: AiStatus | null;
  client: WorkbenchClient;
  onStatusChange: (status: AiStatus) => void;
  onContinue?: () => void;
};

/** 可查询和验证的 AI 草稿、当前操作以及保存条件。 */
export type AiFormState = AiDraft & {
  canFetchModels: boolean;
  canEnterModel: boolean;
  canTest: boolean;
  canSave: boolean;
  isFetchingModels: boolean;
  isTesting: boolean;
  operation: RequestAction<AiOperation>;
};

/**
 * 查询可用模型并保存选定项，取不到列表时使用手动测试。
 * 1. 按当前草稿计算允许的动作；2. 串行执行请求并更新草稿。
 * @param options 已保存配置、请求客户端和保存后的回调。
 * @returns 当前表单与受限操作。
 * @throws 无预期错误；请求失败由操作状态报告。
 */
export function useAiForm(options: AiFormOptions): AiFormState {
  const { status, client, onStatusChange, onContinue } = options;
  const draft = useAiDraft(status);
  const { config, hasChanges, isEditingKey, isManualModel, models, test } = draft;
  const [activeAction, setActiveAction] = useState<AiOperation | null>(null);
  // 1. 完整名单只能选择已有项；名单获取失败或截断时才开放手动测试。
  const canFetchModels = Boolean(config.address.trim() && (!isEditingKey || config.apiKey.trim()));
  const canEnterModel =
    models !== null && (models.kind !== 'available' || models.isTruncated === true);
  const canTest = canFetchModels && canEnterModel && isManualModel && isAiModel(config.model);
  const hasEvidence = isManualModel
    ? canTest && test?.kind === 'available'
    : models?.kind === 'available' && models.models.includes(config.model);
  const canContinueSaved = Boolean(
    onContinue && status?.isConfigured && !hasChanges && !isEditingKey,
  );
  const canSaveConfiguration = canFetchModels && hasEvidence;
  const canSave = canContinueSaved || canSaveConfiguration;
  // 2. 一次只执行一项请求，重新查询时先撤销此前验证结果。
  const operation = useRequestAction<AiOperation>({
    perform: async (action) => {
      setActiveAction(action);
      try {
        if (action === 'models' && canFetchModels) {
          draft.updateModels(null);
          try {
            draft.updateModels(
              await client.fetchAiModels({ address: config.address, apiKey: config.apiKey }),
            );
          } catch (error) {
            draft.updateModels({ kind: 'request-failed' });
            throw error;
          }
        }
        if (action === 'test' && canTest) {
          draft.updateTest(null);
          draft.updateTest(await client.testAi(config));
        }
        if (action === 'clear') {
          onStatusChange(await client.clearAiConfig());
          draft.reset();
        }
        if (action === 'save' && canSave) {
          // 新验证过的已有配置也写回验证结果，直接继续向导时则不重复保存。
          if (canSaveConfiguration) onStatusChange(await client.saveAiConfig(config));
          draft.reset();
          onContinue?.();
        }
      } finally {
        setActiveAction(null);
      }
    },
  });
  return {
    ...draft,
    canFetchModels,
    canEnterModel,
    canTest,
    canSave,
    operation,
    isFetchingModels: activeAction === 'models',
    isTesting: activeAction === 'test',
  };
}
