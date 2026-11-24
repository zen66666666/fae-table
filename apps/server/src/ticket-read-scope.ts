// 跟踪单据读取对应的钉钉账号和取消信号，供单据缓存与后台请求校验。
import { getDingtalkConnectionKey } from '../../../packages/core/src/index.ts';
import type { DingtalkStatus } from '../../../packages/core/src/index.ts';
import { canReadTickets } from '../../../packages/dingtalk/src/index.ts';
import type { DingtalkConnectionStatus } from '../../../packages/dingtalk/src/index.ts';

/** 可读取身份与本次范围的信号，只在后台使用。 */
export type TicketAccess = { account: string; connection: DingtalkStatus; signal: AbortSignal };

type ConnectionUpdate = {
  connection: DingtalkConnectionStatus;
  key: string;
  account?: string;
};

/** 隔离可读取的账号批次；重建连接范围后即使切回同一账号也不会接纳旧结果。 */
export class TicketReadScope {
  private readonly shutdown: AbortSignal;
  private current?: ConnectionUpdate & { controller: AbortController };

  /**
   * 建立尚未就绪的读取范围。
   * @param shutdown 本实例停止信号。
   * @throws 无预期错误。
   */
  constructor(shutdown: AbortSignal) {
    this.shutdown = shutdown;
  }

  /**
   * 检查钉钉连接是否发生变化，持久服务只接收已核实的现有账号范围。
   * @param connection 当前钉钉连接状态。
   * @returns 需要替换的连接及可选账号范围，状态未变化或已停止时为 undefined。
   * @throws 无预期错误。
   */
  prepareConnection(connection: DingtalkConnectionStatus): ConnectionUpdate | undefined {
    const organization = connection.profiles.find(
      (profile) => profile.profile === connection.selectedProfile,
    )?.corpId;
    const key = JSON.stringify([getDingtalkConnectionKey(connection), organization]);
    if (this.current?.key === key || this.shutdown.aborted) return;
    return {
      connection,
      key,
      account: canReadTickets(connection)
        ? JSON.stringify([connection.selectedProfile, organization])
        : undefined,
    };
  }

  /**
   * 缓存作废后启用新连接；新的取消信号保证旧批次无法写回。
   * @param update 已核对的连接范围。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  setConnection(update: ConnectionUpdate): void {
    this.current = { ...update, controller: new AbortController() };
  }

  /**
   * 作废此前所有身份访问，立即取消旧请求。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  invalidate(): void {
    const previous = this.current;
    this.current = undefined;
    previous?.controller.abort();
  }

  /**
   * 读取已完成的钉钉连接范围，未就绪时禁止执行业务查询。
   * @returns 连接和批次取消信号，尚不可读时为 undefined。
   * @throws 无预期错误。
   */
  getAccess(): TicketAccess | undefined {
    if (!this.current?.account || this.shutdown.aborted) return;
    return {
      account: this.current.account,
      connection: this.current.connection,
      signal: AbortSignal.any([this.shutdown, this.current.controller.signal]),
    };
  }
}
