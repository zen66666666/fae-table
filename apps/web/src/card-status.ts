// 将连接检查与表单操作状态合并，供有写入操作的连接卡片复用。
import type { ConnectionReason, ConnectionStatus } from '../../../packages/core/src/index.ts';

type ActionState = { reason: ConnectionReason; isPending: boolean };

/** 合并卡片显示状态所需的连接与操作状态。 */
export type CardStatusOptions = {
  status: ConnectionStatus | null;
  actions: ActionState[];
  isPending?: boolean;
};

/**
 * 优先展示用户刚触发的操作结果，其次展示连接检查状态。
 * @param options 连接状态、按优先级排序的操作及外部等待标记。
 * @returns 卡片应显示的连接状态和原因类别。
 * @throws 无预期错误。
 */
export function resolveCardStatus(options: CardStatusOptions): ConnectionStatus {
  const actionReason = options.actions.find((action) => action.reason !== 'none')?.reason;
  const reason = actionReason ?? options.status?.reason ?? 'none';
  const isPending = options.isPending || options.actions.some((action) => action.isPending);
  const state = isPending
    ? 'checking'
    : actionReason
      ? 'failed'
      : (options.status?.state ?? 'unchecked');
  return { state, reason };
}
