// 为本机网页投影不含身份的账号句柄，真实 profile 和组织标识只保存在后台内存。
import { AppError } from '../../../packages/core/src/index.ts';
import type { DingtalkStatus } from '../../../packages/core/src/index.ts';
import type { DingtalkConnectionStatus } from '../../../packages/dingtalk/src/index.ts';

const PROFILE_KEY_PREFIX = 'profile-';

type ProfileEntry = { profile: string; organization: string; key: string };

/** 将 CLI 账号标识与网页稳定句柄相互映射，不持久化任何映射。 */
export class ProfileSelection {
  private createSecret: () => string;
  private entries = new Map<string, ProfileEntry>();
  private sequence = 0;

  /**
   * 创建当前后台实例专用的账号映射。
   * @param createSecret 可替换的随机字符串工厂。
   * @throws 随机值工厂失败时抛错，由后台安全错误处理转换。
   */
  constructor(createSecret: () => string) {
    this.createSecret = createSecret;
  }

  /**
   * 将内部连接状态投影为网页契约，真实身份不能通过 profile 字符串间接泄漏。
   * @param status CLI 已校验的内部状态。
   * @returns 含不透明句柄、组织标签及当前登录显示姓名的网页状态。
   * @throws 随机值工厂失败时抛错，不返回半成品状态。
   */
  project(status: DingtalkConnectionStatus): DingtalkStatus {
    const current = new Set(status.profiles.map((profile) => profile.profile));
    for (const profile of this.entries.keys()) {
      if (!current.has(profile)) this.entries.delete(profile);
    }
    const profiles = status.profiles.map((profile) => {
      let entry = this.entries.get(profile.profile);
      if (!entry) {
        entry = {
          profile: profile.profile,
          organization: profile.corpId,
          key: `${PROFILE_KEY_PREFIX}${this.createSecret()}-${this.sequence++}`,
        };
        this.entries.set(profile.profile, entry);
      }
      entry.organization = profile.corpId;
      // 账号名只用于当前登录提示，候选列表仍沿用原来的组织标签。
      const accountName =
        status.isLoggedIn && status.selectedProfile === profile.profile
          ? profile.accountName
          : undefined;
      return { profile: entry.key, label: profile.label, accountName };
    });
    return {
      state: status.state,
      reason: status.reason,
      isInstalled: status.isInstalled,
      version: status.version,
      isLoggedIn: status.isLoggedIn,
      isProfileSelectionRequired: status.isProfileSelectionRequired,
      isLoginInProgress: status.isLoginInProgress,
      profiles,
      selectedProfile: status.selectedProfile
        ? (this.entries.get(status.selectedProfile)?.key ?? null)
        : null,
    };
  }

  /**
   * 解析网页此前取得的账号句柄，不接受真实 CLI 标识作为替代输入。
   * @param key 本实例已展示的账号句柄。
   * @returns 仅供后台账号校验和固定登录命令使用的内部账号。
   * @throws AppError：账号句柄不存在或已经失效。
   */
  resolve(key: string): { profile: string; organization: string } {
    const entry = [...this.entries.values()].find((profile) => profile.key === key);
    if (!entry) throw new AppError('identity', 'profile_invalid', 'profile');
    return { profile: entry.profile, organization: entry.organization };
  }
}
