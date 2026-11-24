// 为连接检查与单据缓存生成一致的失效标识，后台和钉钉模块共同使用。
import type { DingtalkStatus } from './connection-types.ts';

/**
 * 根据影响读取权限的钉钉连接字段生成仅供内存比较的标识。
 * @param connection 当前连接状态；不包含身份核验缓存中的 userId 或 corpId。
 * @returns 状态或选定账号变化时不同的字符串；调用方不得将其记录日志或发给网页。
 * @throws 无。
 */
export function getDingtalkConnectionKey(connection: DingtalkStatus): string {
  return JSON.stringify([
    connection.state,
    connection.reason,
    connection.selectedProfile,
    connection.isLoggedIn,
    connection.isProfileSelectionRequired,
    connection.isLoginInProgress,
  ]);
}
