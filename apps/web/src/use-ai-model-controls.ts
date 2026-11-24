// 管理全工作台共用的模型切换和列表刷新，由右栏标题调用。
import { useState } from 'react';
import type { AiStatus, ConnectionReason } from '../../../packages/core/src/index.ts';
import { getAiModelsMessage } from './ai-copy.ts';
import type { WorkbenchClient } from './api-client.ts';
import { useRequestAction } from './use-request-action.ts';

type ModelAction = { kind: 'switch'; model: string } | { kind: 'refresh' };
const NO_MODELS: readonly string[] = [];

/** 当前模型、可选模型与共享操作状态。 */
export type AiModelControls = {
  model: string;
  models: readonly string[];
  isModelListTruncated: boolean;
  isPending: boolean;
  isAnswering: boolean;
  message: string;
  reason: ConnectionReason;
  select: (model: string) => void;
  refresh: () => void;
};

/**
 * 将切换或刷新结果同步到共同连接状态，单据切换时仍保留正在执行的操作。
 * @param options AI 状态、同源客户端和写入共享状态的回调。
 * @returns 右栏下拉框的模型、操作及提示。
 * @throws 无预期错误；后端拒绝仅以安全类别显示。
 */
export function useAiModelControls(options: {
  status: AiStatus | null;
  client: WorkbenchClient;
  isAnyAnswering?: boolean;
  onStatusChange: (status: AiStatus) => void;
}): AiModelControls {
  const { status, client, isAnyAnswering, onStatusChange } = options;
  const [message, setMessage] = useState('');
  const savedModels = status?.models ?? NO_MODELS;
  const model = status?.model ?? '';
  const isModelListTruncated = status?.isModelListTruncated === true;
  const models =
    isModelListTruncated && model && !savedModels.includes(model)
      ? [...savedModels, model]
      : savedModels;
  const isAnswering = isAnyAnswering ?? status?.isAnswering === true;
  const action = useRequestAction<ModelAction>({
    perform: async (value) => {
      setMessage('');
      if (value.kind === 'switch') {
        onStatusChange(await client.switchAiModel(value.model));
      } else {
        const refreshed = await client.refreshAiModels();
        onStatusChange(refreshed.status);
        setMessage(getAiModelsMessage(refreshed.result));
      }
    },
  });
  return {
    model,
    models,
    isModelListTruncated,
    isPending: action.isPending,
    isAnswering,
    message,
    reason: action.reason,
    select: (model) => {
      if (!isAnswering && model !== status?.model && models.includes(model))
        void action.run({ kind: 'switch', model });
    },
    refresh: () => {
      if (!isAnswering && models.length) void action.run({ kind: 'refresh' });
    },
  };
}
