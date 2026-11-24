// 为独立连接缓存提供完整的初始状态，供后台立即响应首次状态请求。
import type { CatalogStatus } from '../../../packages/core/src/index.ts';
import type { DingtalkConnectionStatus } from '../../../packages/dingtalk/src/index.ts';

/**
 * 创建尚未检查的钉钉状态。
 * @returns 不含身份资料的初始状态。
 * @throws 不抛出预期错误。
 */
export function createInitialDingtalkStatus(): DingtalkConnectionStatus {
  return {
    state: 'unchecked',
    reason: 'none',
    isInstalled: false,
    version: null,
    isLoggedIn: false,
    profiles: [],
    isProfileSelectionRequired: false,
    selectedProfile: null,
    isLoginInProgress: false,
  };
}

/**
 * 创建尚未检查的资料目录状态。
 * @param folder 已配置的目录，可省略。
 * @returns 等待检查的目录状态，尚未统计文件。
 * @throws 不抛出预期错误。
 */
export function createInitialCatalogStatus(folder?: string): CatalogStatus {
  return { state: 'unchecked', reason: 'none', folder: folder ?? null, pdfCount: 0 };
}
