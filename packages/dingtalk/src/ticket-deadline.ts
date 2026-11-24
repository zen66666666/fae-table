// 为单据列表建立覆盖身份和分页的统一预算，不另行管理进程。
import { AppError } from '../../core/src/index.ts';
import type { Run } from './common.ts';
import type { RunnerResult } from './runner-types.ts';
import { createTicketRunner } from './ticket-options.ts';
import type { TicketReadOptions } from './ticket-options.ts';

const TICKET_LIST_TIMEOUT_MS = 210_000;

/** 列表读取上下文；统一信号交给内存 runner，底层进程仍由 core 唯一管理。 */
export type TicketListContext = { run: Run; signal: AbortSignal };
type BoundedRead = { run: Run; args: string[]; signal: AbortSignal; deadline: AbortSignal };

function createCancellationError(deadline: AbortSignal): AppError {
  return new AppError(
    deadline.aborted ? 'timeout' : 'process',
    deadline.aborted ? 'ticket_read_timeout' : 'aborted',
    'ticket list',
  );
}

function runWithinBudget(options: BoundedRead): Promise<RunnerResult> {
  if (options.signal.aborted) return Promise.reject(createCancellationError(options.deadline));
  // 注入执行器也必须遵守列表总预算；此处只取消等待，真实进程由同一个信号交给 core 停止。
  return new Promise((resolve, reject) => {
    const abort = () => reject(createCancellationError(options.deadline));
    options.signal.addEventListener('abort', abort, { once: true });
    if (options.signal.aborted) {
      options.signal.removeEventListener('abort', abort);
      abort();
      return;
    }
    Promise.resolve()
      .then(() => options.run(options.args))
      .then(resolve, reject)
      .finally(() => options.signal.removeEventListener('abort', abort));
  });
}

/**
 * 合并服务停止信号与整个列表的总预算，并建立无日志执行器。
 * @param options 当前连接及可替换的进程、时钟信号和执行器依赖。
 * @returns 所有列表阶段共用的执行函数与取消信号。
 * @throws 超时信号工厂或执行器配置无效时抛错，由列表入口转换为失败结果。
 */
export function createTicketListContext(options: TicketReadOptions): TicketListContext {
  const deadline = (options.createTimeoutSignal ?? AbortSignal.timeout)(TICKET_LIST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const run = createTicketRunner({ ...options, signal });
  return { signal, run: (args) => runWithinBudget({ run, args, signal, deadline }) };
}
