// 通过只读认证状态与身份列表交叉核对当前钉钉身份。
import { AppError, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { mustSucceed } from './common.ts';
import type { Run } from './common.ts';

/** 已核实的身份信息；仅供调用参数与内存中的用户匹配使用。 */
export type Identity = { profile: string; userId: string; corpId: string };

function assertAuthentication(auth: JsonObject, requestedProfile?: string): void {
  if (auth.authenticated !== true) {
    throw new AppError('authentication', 'login_required', 'auth status');
  }
  // 多身份场景必须明确选择，避免将默认账号误作当前操作人。
  if (
    !requestedProfile &&
    ((Array.isArray(auth.profiles) && auth.profiles.length > 1) ||
      (typeof auth.profile_count === 'number' && auth.profile_count > 1))
  ) {
    throw new AppError('identity', 'multiple_profiles', 'auth status');
  }
}

function matchIdentity(auth: JsonObject, list: JsonObject, requestedProfile?: string): Identity {
  if (!Array.isArray(list.profiles) || !list.profiles.every(isObject)) {
    throw new AppError('structure', 'invalid_profiles', 'profile list');
  }
  const profiles = list.profiles as JsonObject[];
  if (!requestedProfile && profiles.length > 1) {
    throw new AppError('identity', 'multiple_profiles', 'profile list');
  }
  if (!profiles.length) throw new AppError('identity', 'no_profiles', 'profile list');
  if (
    typeof auth.corp_id !== 'string' ||
    !auth.corp_id ||
    typeof auth.user_id !== 'string' ||
    !auth.user_id
  ) {
    throw new AppError('identity', 'missing_identity', 'auth status');
  }
  const matched = profiles.filter(
    (profile) => profile.corpId === auth.corp_id && profile.userId === auth.user_id,
  );
  if (
    matched.length !== 1 ||
    typeof matched[0].profile !== 'string' ||
    !matched[0].profile ||
    matched[0].profile.includes(',')
  ) {
    throw new AppError('identity', 'ambiguous_identity', 'profile list');
  }
  if (requestedProfile) {
    const selected = profiles.filter(
      (profile) => profile.profile === requestedProfile || profile.corpId === requestedProfile,
    );
    if (selected.length !== 1 || selected[0].profile !== matched[0].profile) {
      throw new AppError('identity', 'profile_mismatch', 'auth status');
    }
  }
  return { profile: matched[0].profile, corpId: auth.corp_id, userId: auth.user_id };
}

/**
 * 只读取 CLI 的认证状态与身份列表，不访问凭据存储。
 * @param run 经过白名单校验的命令执行器。
 * @param requestedProfile 可选的完整身份名或唯一组织标识。
 * @returns 交叉核对成功的单一身份。
 * @throws AppError 认证缺失、身份不唯一、结构异常或调用失败时抛出。
 */
export async function identify(run: Run, requestedProfile?: string): Promise<Identity> {
  if (
    requestedProfile !== undefined &&
    (!requestedProfile.trim() || requestedProfile.includes(','))
  ) {
    throw new AppError('identity', 'invalid_profile', 'auth status');
  }
  const authArgs = ['auth', 'status', '--readonly', '-f', 'json'];
  if (requestedProfile) authArgs.push('--profile', requestedProfile);
  const auth = mustSucceed(await run(authArgs), 'auth status');
  assertAuthentication(auth, requestedProfile);
  const list = mustSucceed(await run(['profile', 'list', '-f', 'json']), 'profile list');
  return matchIdentity(auth, list, requestedProfile);
}
