// 定义单据只读入口的环境依赖和连接前置条件，供列表与详情读取共用。
import type { DingtalkStatus, SpawnProcess, TicketSummary } from '../../core/src/index.ts';
import type { Run } from './common.ts';
import { createRunner } from './runner.ts';
import type { MemberNameResolver } from './member-name-resolver.ts';

/** 单次钉钉读取命令最多运行的时间，单位为毫秒。 */
export const TICKET_COMMAND_TIMEOUT_MS = 30_000;

/** 单据读取配置；run 只用于替换受控读取，默认执行器始终关闭原始输出落盘。 */
export type TicketReadOptions = {
  connection: DingtalkStatus;
  run?: Run;
  spawn?: SpawnProcess;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: () => number;
  /** 可替换列表总预算的超时信号工厂；默认使用 AbortSignal.timeout。 */
  createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
  /** 可替换姓名补全；默认通过当前账号的无日志通讯录只读入口解析。 */
  resolveMemberNames?: MemberNameResolver;
};

/** 单据详情参数；ticket 必须由后台当前账号的最近一次列表提供。 */
export type TicketDetailOptions = TicketReadOptions & {
  ticket: TicketSummary;
  /** 写入后单次回读关闭补读；普通预读仍补读失败的辅助接口。 */
  shouldRetryParts?: boolean;
};

/**
 * 判断连接页是否已完成当前账号的登录和选择。
 * @param connection 后台当前连接摘要。
 * @returns 可以读取当前账号单据时为 true。
 * @throws 无。
 */
export function canReadTickets(connection: DingtalkStatus): boolean {
  return (
    connection.state === 'ready' &&
    connection.isLoggedIn &&
    !connection.isLoginInProgress &&
    !connection.isProfileSelectionRequired &&
    Boolean(connection.selectedProfile)
  );
}

/**
 * 创建仅驻留内存的单据执行器，或使用显式注入的执行器。
 * @param options 进程、环境与取消信号。
 * @returns 受控只读命令的执行函数。
 * @throws 默认执行器参数无效时可能抛错，由业务入口转换为失败结果。
 */
export function createTicketRunner(options: TicketReadOptions): Run {
  return (
    options.run ??
    createRunner({
      canWriteLogs: false,
      spawn: options.spawn,
      environment: options.environment,
      signal: options.signal,
      timeoutMs: TICKET_COMMAND_TIMEOUT_MS,
    })
  );
}
