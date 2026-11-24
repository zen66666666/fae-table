// 管理问答首文本、总时限和取消，供模型请求及读取循环共用。
import type { AiChatOutcome } from '../../core/src/index.ts';
import { CHAT_FIRST_TEXT_TIMEOUT_MS, CHAT_TOTAL_TIMEOUT_MS } from './constants.ts';

type TimeoutFactory = (milliseconds: number) => AbortSignal;
type ChatDeadline = {
  signal: AbortSignal;
  acceptText: () => void;
  interruption: () => AiChatOutcome | undefined;
};

/**
 * 用共同取消信号中断等待，即使注入的网络替身不负责转发信号。
 * @param operation 正在等待的网络、读取或配置快照操作。
 * @param signal 业务停止或截止信号。
 * @returns 完成的结果；停止时以信号原因为内部错误。
 * @throws 业务中止或操作失败，由调用层安全分类。
 */
export function waitForChat<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const remove = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void operation.then(
      (value) => {
        remove();
        resolve(value);
      },
      (error: unknown) => {
        remove();
        reject(error);
      },
    );
  });
}

/**
 * 为一次流式请求组合用户取消、总时限和可解除的首文本时限。
 * @param options 本轮停止信号及可替换时间依赖。
 * @returns 组合后的信号、首文本确认与安全中止原因。
 * @throws 无预期错误；时间依赖本身出错时由调用方处理。
 */
export function createChatDeadline(options: {
  signal: AbortSignal;
  createTimeoutSignal?: TimeoutFactory;
}): ChatDeadline {
  const createTimeout = options.createTimeoutSignal ?? AbortSignal.timeout;
  const firstTimeout = createTimeout(CHAT_FIRST_TEXT_TIMEOUT_MS);
  const totalTimeout = createTimeout(CHAT_TOTAL_TIMEOUT_MS);
  const first = new AbortController();
  const stopFirst = () => first.abort(firstTimeout.reason);
  if (firstTimeout.aborted) stopFirst();
  else firstTimeout.addEventListener('abort', stopFirst, { once: true });
  return {
    signal: AbortSignal.any([options.signal, totalTimeout, first.signal]),
    acceptText: () => firstTimeout.removeEventListener('abort', stopFirst),
    interruption: () => {
      if (options.signal.aborted) return { kind: 'stopped' };
      if (first.signal.aborted || totalTimeout.aborted) return { kind: 'timeout' };
      return undefined;
    },
  };
}
