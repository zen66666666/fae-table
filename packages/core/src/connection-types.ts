// 定义后台和网页共同使用的连接状态及配置契约，避免两端各自解释状态。
import type { AiStatus } from './ai-types.ts';

const CATALOG_FOLDER_REASONS = [
  'folder-required',
  'folder-missing',
  'folder-invalid',
  'folder-not-allowed',
  'folder-parent-missing',
  'folder-not-writable',
  'folder-disk-full',
] as const;

/** 获取连接状态与显式刷新连接状态的固定请求路径。 */
export const WORKBENCH_STATUS_ROUTES = {
  status: '/api/status',
  refresh: '/api/status/refresh',
} as const;

/** 资料文件夹选择使用的受保护本机接口。 */
export const CATALOG_FOLDER_PICK_ROUTE = '/api/catalog/folder/pick';

/** 文件夹选择结果；路径只有在用户确认时返回，保存仍需再次验证。 */
export type CatalogFolderPickResult =
  | { kind: 'selected'; folder: string }
  | { kind: 'cancelled' | 'busy' | 'unsupported' | 'failed' };

/** 本机资料文件夹的安全失败原因，供设置页与接口复用。 */
export type CatalogFolderReason = (typeof CATALOG_FOLDER_REASONS)[number];

/** 已保存资料目录无法写入的固定原因，供目录检查和手册写入共用。 */
export type CatalogWriteFailureReason = Extract<
  CatalogFolderReason,
  'folder-not-writable' | 'folder-disk-full'
>;

/**
 * 检查错误子类型是否属于允许公开的资料文件夹原因。
 * @param reason 候选错误子类型，可能来自内部异常。
 * @returns 符合固定清单时为 true。
 * @throws 无预期错误。
 */
export function isCatalogFolderReason(reason: unknown): reason is CatalogFolderReason {
  return CATALOG_FOLDER_REASONS.some((code) => code === reason);
}

/** 连接检查阶段；网页将其映射为用户可读的状态标签。 */
export type ConnectionState = 'unchecked' | 'checking' | 'ready' | 'action-required' | 'failed';

/** 可公开的连接原因类别；不得携带原始异常、凭据或账号隐私。 */
export type ConnectionReason =
  | 'none'
  | 'not-installed'
  | 'login-required'
  | 'profile-required'
  | 'profile-invalid'
  | CatalogFolderReason
  | 'permission'
  | 'session-expired'
  | 'timeout'
  | 'process'
  | 'protocol'
  | 'configuration'
  | 'key-required'
  | 'model-selection-required'
  | 'model-test-required'
  | 'ai-answering'
  | 'ai-already-answering'
  | 'unknown'
  | 'login-in-progress'
  | 'login-failed';

/** 单项连接的检查阶段和安全原因类别。 */
export type ConnectionStatus = { state: ConnectionState; reason: ConnectionReason };

/** 本机账号选择信息；标签为组织名称或组织 ID 后缀，不记录日志或发送给模型。 */
export type DingtalkProfile = { profile: string; label: string; accountName?: string };

/** 钉钉连接摘要，供后台状态接口和准备页共用。 */
export type DingtalkStatus = ConnectionStatus & {
  isInstalled: boolean;
  version: string | null;
  isLoggedIn: boolean;
  profiles: DingtalkProfile[];
  isProfileSelectionRequired: boolean;
  selectedProfile: string | null;
  isLoginInProgress: boolean;
};

/** 资料目录连接摘要；建议路径仅用于预填，PDF 统计不读取文档正文。 */
export type CatalogStatus = ConnectionStatus & {
  folder: string | null;
  canPickFolder?: boolean;
  suggestedFolder?: string | null;
  pdfCount: number;
  isPdfCountLimited?: boolean;
  pdfCountLimit?: number;
};

/** 工作台与设置向导的连接状态，作为 GET /api/status 的返回契约。 */
export type WorkbenchStatus = {
  dingtalk: DingtalkStatus;
  ai: AiStatus;
  catalog: CatalogStatus;
};

/** 独立钉钉登录进程的安全结果，不包含授权页内容或凭据。 */
export type LoginResult = {
  kind: 'success' | 'failure' | 'timeout' | 'already-running';
  reason: ConnectionReason;
};

/** 数据目录中的持久配置，仅保存账号选择和资料目录。 */
export type AppConfig = { dingtalkProfile?: string; catalogFolder?: string };
