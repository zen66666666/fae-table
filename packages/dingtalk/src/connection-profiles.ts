// 校验和投影身份目录，供连接检查向网页返回最少的账号选择信息。
import { AppError, isObject } from '../../core/src/index.ts';
import type { DingtalkProfile, DingtalkStatus, JsonObject } from '../../core/src/index.ts';
import {
  PROFILE_LABEL_MAX_LENGTH,
  PROFILE_LABEL_PREFIX,
  PROFILE_LABEL_SUFFIX_LENGTH,
} from './connection-constants.ts';

/** 供钉钉核验和后台登录映射使用的账号；corpId 必须在后台网页投影时移除。 */
export type ConnectionProfile = DingtalkProfile & { corpId: string };

/** 后台内部连接状态；包含已核实组织标识，禁止直接作为网页 API 的响应。 */
export type DingtalkConnectionStatus = Omit<DingtalkStatus, 'profiles'> & {
  profiles: ConnectionProfile[];
};

function getProfileLabel(options: { corpName: unknown; corpId: string }): string {
  // CLI 的 corpName 明确表示组织名称，不猜测 name、userName 等可能含个人信息的字段。
  if (typeof options.corpName === 'string') {
    const organizationName = options.corpName.trim();
    if (organizationName && !/[\u0000-\u001f\u007f]/.test(organizationName)) {
      return organizationName.slice(0, PROFILE_LABEL_MAX_LENGTH);
    }
  }
  return `${PROFILE_LABEL_PREFIX} ${options.corpId.slice(-PROFILE_LABEL_SUFFIX_LENGTH)}`;
}

/**
 * 校验钉钉明确给出的显示姓名，禁止以邮箱、身份标识或控制字符替代。
 * @param value 来自已知显示姓名字段的值。
 * @param identifiers 本次读取核实的内部标识，不能作为姓名。
 * @returns 有界、可显示的姓名，无法确认时为 undefined。
 * @throws 无预期错误。
 */
export function readProfileAccountName(
  value: unknown,
  identifiers: readonly unknown[],
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (!name || /[@\p{Cc}]/u.test(name) || identifiers.includes(name)) return undefined;
  return name.slice(0, PROFILE_LABEL_MAX_LENGTH);
}

/**
 * 从已校验的 CLI 目录中提取账号选择信息，不暴露用户标识或邮箱。
 * @param payload 身份目录对象。
 * @returns 可以选择的 profile、组织标识和组织显示名，缺失名称时使用组织标识末六位。
 * @throws AppError：身份字段不完整或目录含重复 profile。
 */
export function parseConnectionProfiles(payload: JsonObject): ConnectionProfile[] {
  if (!Array.isArray(payload.profiles))
    throw new AppError('protocol', 'invalid_profiles', 'profile list');
  const seen = new Set<string>();
  return payload.profiles.map((entry) => {
    if (
      !isObject(entry) ||
      typeof entry.profile !== 'string' ||
      !entry.profile ||
      typeof entry.corpId !== 'string' ||
      !entry.corpId ||
      seen.has(entry.profile)
    ) {
      throw new AppError('protocol', 'invalid_profile', 'profile list');
    }
    seen.add(entry.profile);
    // 设置页只需组织和显示姓名，不转交 CLI 目录中的邮箱、成员编号等信息。
    return {
      profile: entry.profile,
      corpId: entry.corpId,
      label: getProfileLabel({ corpName: entry.corpName, corpId: entry.corpId }),
      accountName: readProfileAccountName(entry.userName, [
        entry.profile,
        entry.corpId,
        entry.userId,
      ]),
    };
  });
}

/**
 * 从目录中解析唯一选择，兼容完整 profile 与唯一组织标识。
 * @param profiles 已投影的身份目录。
 * @param requestedProfile 用户保存的账号选择。
 * @returns 唯一匹配的账号，没有明确选择且仅一项时选该项，否则为 null。
 * @throws 无；多义选择返回 null，由调用方要求用户处理。
 */
export function selectConnectionProfile(
  profiles: ConnectionProfile[],
  requestedProfile?: string,
): ConnectionProfile | null {
  if (!requestedProfile) return profiles.length === 1 ? profiles[0] : null;
  const matched = profiles.filter(
    (item) => item.profile === requestedProfile || item.corpId === requestedProfile,
  );
  return matched.length === 1 ? matched[0] : null;
}
