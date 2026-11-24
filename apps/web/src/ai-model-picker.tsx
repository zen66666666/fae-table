// 提供模型下拉框，供 AI 连接设置和工作台助手共用。
import { useId } from 'react';
import type { ReactElement } from 'react';
import { AI_COPY } from './ai-copy.ts';

const REFRESH_OPTION = 'refresh-models';
const HINT_OPTION = 'list-hint';

/** 候选模型、当前所选名称及用户选择回调。 */
export type AiModelPickerProps = {
  models: readonly string[];
  model: string;
  isDisabled: boolean;
  onSelect: (model: string) => void;
  onRefresh?: () => void;
  listHint?: string;
  isCompact?: boolean;
};

/**
 * 展示后台验证过的模型；工作台可以附带刷新列表选项。
 * @param props 后台验证过的模型名称与选择操作。
 * @returns 带可选刷新动作的原生下拉框。
 * @throws 无预期错误。
 */
export function AiModelPicker({
  models,
  model,
  isDisabled,
  onSelect,
  onRefresh,
  listHint,
  isCompact = false,
}: AiModelPickerProps): ReactElement {
  const id = useId();
  const index = models.indexOf(model);
  return (
    <label className="ai-field ai-model-picker" htmlFor={id}>
      {!isCompact && <span>{AI_COPY.model}</span>}
      <select
        id={id}
        aria-label={isCompact ? AI_COPY.model : undefined}
        value={index < 0 ? '' : String(index)}
        disabled={isDisabled}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === REFRESH_OPTION) onRefresh?.();
          else if (value && models[Number(value)] !== undefined) onSelect(models[Number(value)]);
        }}
      >
        {index < 0 && (
          <option value="" disabled>
            {onRefresh && model ? model : AI_COPY.chooseModel}
          </option>
        )}
        {/* 模型使用数字下标作为值，模型名即使与刷新命令同名也不会触发命令。 */}
        {models.map((name, position) => (
          <option key={name} value={position}>
            {name}
          </option>
        ))}
        {onRefresh && <option value={REFRESH_OPTION}>{AI_COPY.refreshModels}</option>}
        {listHint && (
          <option value={HINT_OPTION} disabled>
            {listHint}
          </option>
        )}
      </select>
    </label>
  );
}
