// 管理内存中的地址、Key、模型及对应验证结果，供 AI 设置表单使用。
import { useState } from 'react';
import { hasSameAiOrigin } from '../../../packages/core/src/index.ts';
import type {
  AiConfigInput,
  AiModelsResult,
  AiStatus,
  AiTestResult,
} from '../../../packages/core/src/index.ts';

/** 本机表单中的查询结果；本机接口请求失败时仍能尝试手动测试。 */
export type AiModelDiscovery = AiModelsResult | { kind: 'request-failed' };

type DraftState = {
  input: AiConfigInput | null;
  models: AiModelDiscovery | null | undefined;
  test: AiTestResult | null;
  isChangingKey: boolean;
  isManualModel?: boolean;
};

const EMPTY_DRAFT: DraftState = {
  input: null,
  models: undefined,
  test: null,
  isChangingKey: false,
};

/** 当前输入及仅与本次输入绑定的模型列表和测试结果。 */
export type AiDraft = {
  config: AiConfigInput;
  models: AiModelDiscovery | null;
  test: AiTestResult | null;
  hasChanges: boolean;
  hasChangedServer: boolean;
  isEditingKey: boolean;
  isManualModel: boolean;
  updateField: (field: keyof AiConfigInput, value: string) => void;
  updateModel: (options: { value: string; isManual: boolean }) => void;
  toggleKeyEditing: () => void;
  updateModels: (models: AiModelDiscovery | null) => void;
  updateTest: (test: AiTestResult | null) => void;
  reset: () => void;
};

function getSavedInput(status: AiStatus | null): AiConfigInput {
  return { address: status?.address ?? '', model: status?.model ?? '', apiKey: '' };
}

function selectDefaultModel(result: AiModelsResult, previousModel: string): string {
  if (result.isTruncated || result.models.includes(previousModel)) return previousModel;
  return result.models.length === 1 ? result.models[0] : '';
}

function updateInput(options: {
  state: DraftState;
  fallback: AiConfigInput;
  field: keyof AiConfigInput;
  value: string;
}): DraftState {
  const { state, fallback, field, value } = options;
  const previous = state.input ?? fallback;
  if (previous[field] === value) return state;
  const input = { ...previous, [field]: value };
  // 草稿 Key 也属于原服务器，改服务器时必须清空，避免发送给别的服务。
  if (field === 'address' && !hasSameAiOrigin(previous.address, value)) {
    input.apiKey = '';
    input.model = '';
  }
  return { ...state, input, models: undefined, test: null, isManualModel: undefined };
}

/**
 * 管理 AI 草稿，在地址或 Key 变化时清除旧列表与测试结果。
 * 1. 根据保存状态和服务器来源计算 Key 输入；2. 绑定编辑与验证结果。
 * @param status 当前持久配置的公开摘要。
 * @returns 易失草稿及更新函数。
 * @throws 无预期错误。
 */
export function useAiDraft(status: AiStatus | null): AiDraft {
  const [state, setState] = useState<DraftState>(EMPTY_DRAFT);
  // 1. 只有同源服务器才可以继续使用已保存的 Key。
  const saved = getSavedInput(status);
  const config = state.input ?? saved;
  const isConfigured = status?.isConfigured === true;
  const hasChangedServer = isConfigured && !hasSameAiOrigin(config.address, saved.address);
  const isEditingKey = state.isChangingKey || hasChangedServer || !isConfigured;
  // 已保存的候选只属于原地址和原 Key；编辑凭据时等本次查询结果再显示选项。
  const savedModels =
    config.address === saved.address &&
    !isEditingKey &&
    !config.apiKey &&
    status?.models !== undefined
      ? {
          kind: 'available' as const,
          models: status.models,
          isTruncated: status.isModelListTruncated,
        }
      : null;
  const models = state.models === undefined ? savedModels : state.models;
  const isManualModel =
    models?.kind === 'available'
      ? (state.isManualModel ??
        Boolean(models.isTruncated && config.model && !models.models.includes(config.model)))
      : models !== null;
  const hasChanges = Boolean(
    config.apiKey || config.address !== saved.address || config.model !== saved.model,
  );
  // 2. 地址或 Key 变化会使列表失效，手动修改模型只使该模型的测试失效。
  function updateField(field: keyof AiConfigInput, value: string): void {
    setState((current) => updateInput({ state: current, fallback: saved, field, value }));
  }
  function updateModel({ value, isManual }: { value: string; isManual: boolean }): void {
    setState((current) => ({
      ...current,
      input: { ...(current.input ?? saved), model: value },
      isManualModel: isManual,
      test: null,
    }));
  }
  function toggleKeyEditing(): void {
    setState((current) => ({
      ...updateInput({ state: current, fallback: saved, field: 'apiKey', value: '' }),
      isChangingKey: !current.isChangingKey,
      models: undefined,
      test: null,
      isManualModel: undefined,
    }));
  }
  function updateModels(models: AiModelDiscovery | null): void {
    setState((current) => ({
      ...current,
      input:
        models?.kind === 'available' && models.models.length
          ? {
              ...(current.input ?? saved),
              model: selectDefaultModel(models, (current.input ?? saved).model),
            }
          : current.input,
      models,
      test: null,
      isManualModel: undefined,
    }));
  }
  return {
    config,
    models,
    test: state.test,
    hasChanges,
    hasChangedServer,
    isEditingKey,
    isManualModel,
    updateField,
    updateModel,
    toggleKeyEditing,
    updateModels,
    updateTest: (test) => setState((current) => ({ ...current, test })),
    reset: () => setState(EMPTY_DRAFT),
  };
}
