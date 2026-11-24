// 声明单据服务与其他后台服务共享的访问契约。
import type {
  TicketDetail,
  TicketDetailSnapshot,
  TicketListItem,
} from '../../../packages/core/src/index.ts';
import type { TicketReader } from '../../../packages/dingtalk/src/index.ts';
import type { TicketAccess } from './ticket-read-scope.ts';
import type { ConnectionContext } from './types.ts';

/** 单据服务上下文；所有环境依赖来自后台实例，身份本身保留在钉钉读取器内部。 */
export type TicketServiceOptions = Pick<
  ConnectionContext,
  'environment' | 'spawn' | 'signal' | 'dependencies'
> & {
  /** 与后台写入器共享的读取器，省略时为单据服务创建私有读取器。 */
  reader?: TicketReader;
  /** 当前身份的详情写入缓存后通知本机资料服务；已作废的结果不会通知。 */
  onDetailRead?: (detail: TicketDetail) => void;
  /** 整轮详情预读结束或单张刷新后交给手册预下载处理；身份失效时传空列表。 */
  onManualPrefetchItems?: (items: readonly TicketListItem[]) => void;
  /** 完整成功的最近单据及账号数判断，用于对话历史安全清理。 */
  onRecentTickets?: (input: { items: readonly TicketListItem[]; isOnlyProfile: boolean }) => void;
  /** 通知对话服务当前已核实的本机账号范围，退出或重新登录时清空。 */
  onAccountScope?: (scope: string | undefined) => void;
};

/** 单据和当前账号范围，或无法取得成员资格的安全原因。 */
export type ListedTicket =
  | { ticket: TicketListItem; access: TicketAccess }
  | { reason: 'not-found' | 'connection-required' };

/** 单张刷新可等已开始的读取结束，或关闭辅助接口在本次读取中的补读。 */
export type TicketDetailUpdateOptions = { isAfterCurrent?: boolean; shouldRetryParts?: boolean };

/**
 * 刷新当前身份的列表单据，更新本机详情、分组及资料状态。
 * @param options 写回核实所需的读取顺序和补读设置。
 * @returns 带读取时间的详情快照，成员或身份失效时返回安全失败。
 * @throws 读取异常转换为安全失败。
 */
export type TicketDetailUpdate = (
  options?: TicketDetailUpdateOptions,
) => Promise<TicketDetailSnapshot>;

/** 一次对话使用的本机身份与列表范围，不包含可外发的身份数据。 */
export type TicketConversationAccess = { signal: AbortSignal; canRead: () => boolean };

/** 单据图片的本机标识，外部图片地址只来自详情投影的私有映射。 */
export type TicketImageInput = { id: string; imageId: string };

/** 图片读取期间持续检查当前账号、列表成员和详情中的图片归属。 */
export type TicketImageAccess = TicketConversationAccess & { url: string };
