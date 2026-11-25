// 显示 AI 首次输出前的等待或思考秒数，仅在回答尚未出现时计时。
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { AI_CHAT_COPY } from './ai-chat-copy.ts';
import { BROWSER_POLLING_CLOCK } from './polling-clock.ts';
import type { PollingClock } from './polling-clock.ts';

const ONE_SECOND_MS = 1_000;

/** 当前阶段起始时刻及可替换的当前时间和计时器。 */
export type AiChatWaitingProps = {
  startedAt: number;
  isThinking: boolean;
  now?: () => number;
  clock?: PollingClock;
};

function getElapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / ONE_SECOND_MS));
}

/**
 * 按当前阶段每秒刷新，开始回答、停止或切换单据后自动注销计时器。
 * @param props 当前阶段、起始时刻和可替换时钟。
 * @returns 回答位置的等待或思考提示。
 * @throws 无预期错误。
 */
export function AiChatWaiting({
  startedAt,
  isThinking,
  now = Date.now,
  clock = BROWSER_POLLING_CLOCK,
}: AiChatWaitingProps): ReactElement {
  const [seconds, setSeconds] = useState(() => getElapsedSeconds(startedAt, now()));
  useEffect(() => {
    // 用实际经过时间计算，避免标签页在后台暂停计时后读数偏小。
    const update = (): void => setSeconds(getElapsedSeconds(startedAt, now()));
    update();
    const timer = clock.setInterval(update, ONE_SECOND_MS);
    return () => clock.clearInterval(timer);
  }, [clock, now, startedAt]);
  return (
    <p className="muted" role="status">
      {isThinking ? AI_CHAT_COPY.formatThinking(seconds) : AI_CHAT_COPY.formatWaiting(seconds)}
    </p>
  );
}
