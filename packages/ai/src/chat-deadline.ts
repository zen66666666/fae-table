// 管理问答的空闲超时与取消，供模型请求及读取循环共用。
import type { AiChatOutcome } from '../../core/src/index.ts';
import { CHAT_IDLE_TIMEOUT_MS } from './constants.ts';

type TimerHandle = ReturnType<typeof setTimeout>;

/** 问答可替换的毫秒时钟和定时器，默认使用系统实现。 */
export type ChatClockOptions = {
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

type ChatDeadline = {
  signal: AbortSignal;
  acceptActivity: () => void;
  close: () => void;
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
 * 为一次流式请求设置随模型输出延长的空闲时限，兼容外部取消。
 * @param options 本轮停止信号及可替换时间依赖。
 * @returns 组合信号、活动重置、定时器清理与安全中止原因。
 * @throws 无预期错误；时间依赖本身出错时由调用方处理。
 */
export function createChatDeadline(
  options: ChatClockOptions & { signal: AbortSignal },
): ChatDeadline {
  // 1. 从请求起设置截止点。2. 模型活动延后截止点。3. 结束时清理定时器。
  const { now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = options;
  const idle = new AbortController();
  const signal = AbortSignal.any([options.signal, idle.signal]);
  let expiresAt = now() + CHAT_IDLE_TIMEOUT_MS;
  // 1. 每次计时器醒来核对实际截止点，避免每段推理都新建定时器。
  const checkExpiry = (): void => {
    const remaining = expiresAt - now();
    if (remaining <= 0) idle.abort();
    else timer = setTimer(checkExpiry, remaining);
  };
  let timer = setTimer(checkExpiry, CHAT_IDLE_TIMEOUT_MS);
  return {
    signal,
    acceptActivity: () => {
      const time = now(); // 2. 定时器若尚未得到执行机会，迟到的文字也不能重置已过的时限。
      if (time >= expiresAt) idle.abort();
      signal.throwIfAborted();
      expiresAt = time + CHAT_IDLE_TIMEOUT_MS;
    },
    close: () => clearTimer(timer), // 3.
    interruption: () => {
      if (options.signal.aborted) return { kind: 'stopped' };
      if (idle.signal.aborted) return { kind: 'timeout' };
      return undefined;
    },
  };
}
