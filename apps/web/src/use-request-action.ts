// 管理卡片操作的等待状态和安全错误类别，供准备页各项操作复用。
import { useRef, useState } from 'react';
import type { ConnectionReason } from '../../../packages/core/src/index.ts';
import { getConnectionErrorReason } from './api-client.ts';

/** 单次操作的输入处理函数和成功后动作。 */
export type RequestActionOptions<Value> = {
  perform: (value: Value) => Promise<void>;
  onSuccess?: () => Promise<void> | void;
};

/** 卡片可观察的操作状态与安全执行入口。 */
export type RequestAction<Value> = {
  isPending: boolean;
  reason: ConnectionReason;
  run: (value: Value) => Promise<void>;
};

/**
 * 复用异步操作的防重复提交、等待状态和错误处理。
 * 1. 锁定当前操作；2. 执行请求和成功回调；3. 释放锁定并显示安全结果。
 * @param options 请求函数及成功回调。
 * @returns 等待标记、原因类别与不会向事件处理器抛错的执行函数。
 * @throws 无；执行错误仅转换为原因类别。
 */
export function useRequestAction<Value>(
  options: RequestActionOptions<Value>,
): RequestAction<Value> {
  const [isPending, setIsPending] = useState(false);
  const [reason, setReason] = useState<ConnectionReason>('none');
  const hasActiveRequest = useRef(false);
  async function run(value: Value): Promise<void> {
    // 1. 使用同步标记，阻止 React 下一次渲染前的重复点击。
    if (hasActiveRequest.current) return;
    hasActiveRequest.current = true;
    setIsPending(true);
    setReason('none');
    try {
      // 2. 仅在业务请求成功后刷新连接状态或切换为退出页面。
      await options.perform(value);
      await options.onSuccess?.();
    } catch (error) {
      setReason(getConnectionErrorReason(error));
    } finally {
      // 3. 错误和成功均释放当前操作，不影响其他卡片或退出按钮。
      hasActiveRequest.current = false;
      setIsPending(false);
    }
  }
  return { isPending, reason, run };
}
