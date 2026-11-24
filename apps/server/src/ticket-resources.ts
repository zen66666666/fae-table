// 为资料、图片、AI、草稿和写回共用列表成员门禁，供后台单据服务调用。
import { isTicketFinished } from '../../../packages/core/src/index.ts';
import type { TicketDetail, TicketField } from '../../../packages/core/src/index.ts';
import { getTicketRecordImageUrl } from '../../../packages/dingtalk/src/index.ts';
import { TICKET_ID_PATTERN } from './constants.ts';
import type { TicketDetailCache } from './ticket-detail-cache.ts';
import type { TicketDraftAccess, TicketDraftCache } from './ticket-draft-cache.ts';
import { TicketImageService } from './ticket-image-service.ts';
import type { TicketAccess } from './ticket-read-scope.ts';
import type {
  ListedTicket,
  TicketConversationAccess,
  TicketImageAccess,
  TicketImageInput,
} from './ticket-service-types.ts';
import type { TicketSnapshotStore } from './ticket-snapshot-store.ts';
import type { ServerDependencies } from './types.ts';

type FieldState = TicketField[] | 'not-found' | 'pending-detail' | 'detail-unavailable';

type ResourceOptions = {
  getScope: () => TicketAccess | undefined;
  snapshots: TicketSnapshotStore;
  details: TicketDetailCache;
  drafts: TicketDraftCache;
  dependencies: Pick<ServerDependencies, 'fetch' | 'schedule' | 'ticketImageCacheMaxBytes'>;
};

/**
 * 创建绑定身份版本和最近列表的单据资源入口，初始化时不访问外部服务。
 * @param options 账号范围、本机快照缓存及图片读取依赖。
 * @returns 独立资源访问函数；各异步访问继续复核原始身份。
 * @throws 无预期错误。
 */
export function createTicketResources(options: ResourceOptions): Readonly<{
  findListedTicket: (id: string) => ListedTicket;
  peekTicketFields: (id: string) => FieldState;
  getTicketFieldsAccess: (id: string) => (() => TicketField[] | undefined) | undefined;
  getConversationAccess: (id: string) => TicketConversationAccess | undefined;
  getDraftAccess: (id: string) => TicketDraftAccess | undefined;
  readTicketImage: (input: TicketImageInput) => ReturnType<TicketImageService['read']>;
  warmTicketImages: (detail: TicketDetail) => void;
  clearTicketImages: () => void;
}> {
  const { getScope, snapshots, details, drafts, dependencies } = options;

  function findListedTicket(id: string): ListedTicket {
    // 格式和最近列表同时校验，避免猜测 ID 枚举当前身份没有读到的单据。
    if (!TICKET_ID_PATTERN.test(id)) return { reason: 'not-found' };
    const access = getScope();
    if (!access) return { reason: 'connection-required' };
    const ticket = snapshots.getItem(id);
    return ticket ? { ticket, access } : { reason: 'not-found' };
  }

  function getConversationAccess(id: string): TicketConversationAccess | undefined {
    const entry = findListedTicket(id);
    if ('reason' in entry) return undefined;
    return {
      signal: entry.access.signal,
      canRead: () => !entry.access.signal.aborted && snapshots.getItem(id) !== undefined,
    };
  }

  function getTicketImageAccess(
    input: TicketImageInput,
    isPrefetch = false,
  ): TicketImageAccess | undefined {
    const { id, imageId } = input;
    const access = getConversationAccess(id);
    if (!access) return;
    function readUrl(): string | undefined {
      const detail = access?.canRead() ? details.peek(id)?.detail : undefined;
      if (!detail) return;
      const ticket = isPrefetch ? snapshots.getItem(id) : undefined;
      // 排队期间流程也可能结束，预取必须再次检查详情和列表的状态。
      if (isPrefetch && (!ticket || isTicketFinished(ticket) || isTicketFinished(detail.summary)))
        return;
      return getTicketRecordImageUrl({ detail, imageId });
    }
    const url = readUrl();
    // 编号稳定也只允许读取当前列表和最新详情仍包含的图片，账号失效后立即拒绝。
    if (url) return { url, signal: access.signal, canRead: () => readUrl() === url };
  }

  const images = new TicketImageService({
    getAccess: getTicketImageAccess,
    fetch: dependencies.fetch,
    schedule: dependencies.schedule,
    maxBytes: dependencies.ticketImageCacheMaxBytes,
  });

  return {
    findListedTicket,
    getConversationAccess,
    readTicketImage: (input) => images.read(input),
    warmTicketImages: (detail) => images.warm(detail),
    clearTicketImages: () => images.clear(),
    peekTicketFields: (id) => {
      if ('reason' in findListedTicket(id)) return 'not-found';
      const detail = details.peek(id)?.detail;
      if (detail) return detail.fields;
      return snapshots.hasFailedDetail(id) ? 'detail-unavailable' : 'pending-detail';
    },
    getTicketFieldsAccess: (id) => {
      const access = getConversationAccess(id);
      return access && (() => (access.canRead() ? details.peek(id)?.detail?.fields : undefined));
    },
    getDraftAccess: (id) => {
      const access = getConversationAccess(id);
      return access && drafts.createAccess({ id, canAccess: access.canRead });
    },
  };
}
