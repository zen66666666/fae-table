// 管理钉钉状态缓存、账号切换和扫码登录，供工作台连接服务使用。
import { AppError } from '../../../packages/core/src/index.ts';
import type { DingtalkStatus, LoginResult } from '../../../packages/core/src/index.ts';
import {
  createMemberNameResolver,
  validateLoginOptions,
} from '../../../packages/dingtalk/src/index.ts';
import type { DingtalkConnectionStatus } from '../../../packages/dingtalk/src/index.ts';
import { ConnectionCache } from './connection-cache.ts';
import { createInitialDingtalkStatus } from './connection-initial-state.ts';
import { ProfileSelection } from './profile-selection.ts';
import type { ConnectionContext } from './types.ts';

type Callbacks = {
  onChange: (status: DingtalkConnectionStatus) => void;
  onInvalidate: (canKeepDrafts: boolean) => void;
};

/** 单独管理钉钉连接，所有单据、编码表订阅者共用同一状态。 */
export class DingtalkConnection {
  private readonly context: ConnectionContext;
  private readonly cache: ConnectionCache<DingtalkConnectionStatus>;
  private readonly profiles: ProfileSelection;
  private readonly accountNames = createMemberNameResolver();
  private readonly onInvalidate: Callbacks['onInvalidate'];
  private isLoginInProgress = false;

  /**
   * 组合钉钉状态缓存和账号选择，不立即启动检查。
   * @param context 后台配置和可替换进程依赖。
   * @param callbacks 状态变化与身份失效通知。
   * @throws 无预期错误。
   */
  constructor(context: ConnectionContext, callbacks: Callbacks) {
    this.context = context;
    this.onInvalidate = callbacks.onInvalidate;
    const { dependencies, signal } = context;
    this.profiles = new ProfileSelection(dependencies.createSecret);
    this.cache = new ConnectionCache({
      now: dependencies.now,
      schedule: dependencies.schedule,
      signal,
      initial: createInitialDingtalkStatus(),
      check: () =>
        dependencies.getDingtalkStatus({
          ...this.getCheckOptions(),
          profile: this.context.config.dingtalkProfile,
          accountNames: this.accountNames,
        }),
      onChange: (status) => callbacks.onChange(this.getEffectiveDingtalk(status)),
    });
  }

  /**
   * 取得当前可公开状态，过期状态在后台刷新。
   * @returns 已投影的连接状态和本实例账号句柄。
   * @throws 无预期错误。
   */
  getStatus(): DingtalkStatus {
    return this.profiles.project(this.getEffectiveDingtalk(this.cache.getSnapshot()));
  }

  /**
   * 主动安排钉钉状态检查。
   * @returns 无返回值，检查在后台执行。
   * @throws 无预期错误。
   */
  refresh(): void {
    void this.cache.refresh();
  }

  private getCheckOptions(): Pick<
    ConnectionContext,
    'dataDir' | 'environment' | 'spawn' | 'signal'
  > {
    const { dataDir, environment, spawn, signal } = this.context;
    return { dataDir, environment, spawn, signal };
  }

  private getEffectiveDingtalk(dingtalk: DingtalkConnectionStatus): DingtalkConnectionStatus {
    return this.isLoginInProgress
      ? { ...dingtalk, state: 'checking', reason: 'login-in-progress', isLoginInProgress: true }
      : dingtalk;
  }

  /**
   * 启动独立钉钉登录，重复请求返回已有登录提示。
   * @param profileKey 可选网页账号句柄，组织 ID 只在后台解析并经过模块校验。
   * @returns 登录成功、失败、超时或已有登录的安全结果。
   * @throws AppError：输入无效、服务已关闭或发生内部异常。
   */
  async login(profileKey?: string): Promise<LoginResult> {
    const profile =
      profileKey === undefined ? undefined : this.profiles.resolve(profileKey).organization;
    validateLoginOptions({ profile });
    if (this.isLoginInProgress) return { kind: 'already-running', reason: 'login-in-progress' };
    if (this.context.signal.aborted) throw new AppError('process', 'server_closed', 'login');
    this.isLoginInProgress = true;
    this.accountNames.invalidate();
    this.onInvalidate(false);
    const { dependencies, spawn, environment, signal } = this.context;
    try {
      return await dependencies.startLogin({ profile }, { spawn, environment, signal });
    } finally {
      this.isLoginInProgress = false;
      this.cache.invalidate();
      this.onInvalidate(false);
      // 登录结束后主动检查，不依赖下一次网页轮询才能预读当前身份的单据。
      this.refresh();
    }
  }

  /**
   * 仅保存最新钉钉账号列表中的选择，不等待资料目录扫描。
   * @param profileKey 本实例网页展示的账号句柄。
   * @returns 完成配置更新；钉钉重新检查在后台进行。
   * @throws AppError：账号不在列表、目录检查失败或配置写入失败。
   */
  async selectProfile(profileKey: string): Promise<void> {
    // 1. 只回读钉钉目录。2. 校验并原子保存。3. 废弃旧状态后返回当前快照。
    const profile = this.profiles.resolve(profileKey).profile;
    const current = await this.cache.refresh();
    if (this.context.signal.aborted) throw new AppError('process', 'server_closed', 'profile');
    if (current.state === 'failed')
      throw new AppError('process', 'profile_lookup_failed', 'profile');
    // 2. 用户输入不能自行扩大可选账号范围，只有明确查到的账号可以保存。
    if (!current.profiles.some((account) => account.profile === profile)) {
      throw new AppError('identity', 'profile_invalid', 'profile');
    }
    const config = { ...this.context.config, dingtalkProfile: profile };
    this.context.dependencies.writeConfiguration({ dataDir: this.context.dataDir, config });
    this.context.config = config;
    // 3. 版本失效防止旧身份的异步返回覆盖新选择。
    this.cache.invalidate();
    this.accountNames.invalidate();
    this.onInvalidate(current.selectedProfile === profile);
  }
}
