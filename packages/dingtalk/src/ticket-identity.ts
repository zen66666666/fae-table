// 为后台连续只读查询缓存已核对身份，userId 和 corpId 始终留在钉钉模块内存。
import { AppError } from '../../core/src/index.ts';
import { identify } from './identity.ts';
import type { Identity } from './identity.ts';
import type { Run } from './common.ts';

const IDENTITY_CACHE_MS = 10 * 60_000;
type CachedIdentity = { profile: string; identity: Identity; checkedAt: number };
type PendingIdentity = { profile: string; revision: number; promise: Promise<Identity> };

/** 模块内的身份缓存；不作为网页数据或公开业务返回值。 */
export class TicketIdentityCache {
  private now: () => number;
  private revision = 0;
  private cached: CachedIdentity | undefined;
  private pending: PendingIdentity | undefined;

  /**
   * 建立没有任何已核对身份的缓存。
   * @param now 可替换时钟，默认使用当前时间，单位毫秒。
   * @throws 无。
   */
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * 作废身份并阻止旧检查回写，供登录、账号切换及连接变化使用。
   * @returns 无返回值。
   * @throws 无；不会终止任何不属于当前查询的进程。
   */
  invalidate(): void {
    this.revision++;
    this.cached = undefined;
    this.pending = undefined;
  }

  /**
   * 读取已核对身份，不等待在途任务，也不启动认证命令。
   * @param profile 已选定的完整账号标识。
   * @returns 未满十分钟的本机身份，缓存缺失或过期时返回 undefined。
   * @throws 无预期错误。
   */
  peekIdentity(profile: string): Identity | undefined {
    const age = this.cached ? this.now() - this.cached.checkedAt : Infinity;
    if (this.cached?.profile === profile && age >= 0 && age < IDENTITY_CACHE_MS)
      return { ...this.cached.identity };
    return undefined;
  }

  /**
   * 获取十分钟内已核对身份，同一账号的并发读取共用在途检查。
   * @param run 当前无日志读取执行器。
   * @param profile 已选定的完整账号标识。
   * @returns 只供模块内部使用的身份；从不作为接口响应发送。
   * @throws AppError：未指定账号、认证失败或读取期间缓存已作废。
   */
  getIdentity(run: Run, profile?: string): Promise<Identity> {
    if (!profile) return Promise.reject(new AppError('identity', 'profile_required', 'identity'));
    const cached = this.peekIdentity(profile);
    if (cached) return Promise.resolve(cached);
    if (this.pending?.profile === profile && this.pending.revision === this.revision) {
      return this.pending.promise;
    }
    const revision = this.revision;
    const promise = this.readIdentity({ run, profile, revision }).finally(() => {
      if (this.pending?.promise === promise) this.pending = undefined;
    });
    this.pending = { profile, revision, promise };
    return promise;
  }

  private async readIdentity(options: {
    run: Run;
    profile: string;
    revision: number;
  }): Promise<Identity> {
    const identity = await identify(options.run, options.profile);
    // 登录或选账号后到达的旧身份不能为新一轮业务查询提供认证结果。
    if (options.revision !== this.revision) {
      throw new AppError('identity', 'identity_invalidated', 'identity');
    }
    this.cached = { profile: options.profile, identity, checkedAt: this.now() };
    return { ...identity };
  }
}
