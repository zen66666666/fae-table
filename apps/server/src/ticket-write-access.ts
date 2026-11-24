// 绑定单据写入使用的账号、列表和草稿访问，供单据服务创建安全句柄。
import { createTicketDetailSnapshotFailure } from '../../../packages/core/src/index.ts';
import type { TicketDetailSnapshot, TicketListItem } from '../../../packages/core/src/index.ts';
import type { TicketApprovalPreview } from './ticket-approval-previews.ts';
import type { TicketDraftAccess } from './ticket-draft-cache.ts';
import type { TicketAccess } from './ticket-read-scope.ts';
import type { TicketDetailUpdate } from './ticket-service-types.ts';

const APPROVAL_SOURCE = 'pending';

/**
 * 依据当前单据的可信来源确认是否待本人处理。
 * @param ticket 当前列表项。
 * @returns 列表仍将单据标为待办时为 true；预读任务另作核实。
 * @throws 无预期错误。
 */
export function hasPendingApprovalSource(ticket: TicketListItem | undefined): boolean {
  return ticket?.sources.includes(APPROVAL_SOURCE) === true;
}

/** 写入服务允许读取的当前账号、单据、草稿和完成后刷新句柄。 */
export type TicketWriteAccess = TicketAccess & {
  getTicket: () => TicketListItem | undefined;
  getDraft: () => string | undefined;
  peekApproval: () => TicketApprovalPreview;
  peekDetail: () => TicketDetailSnapshot | undefined;
  clearDraft: (expected: string | undefined) => void;
  refresh: TicketDetailUpdate;
};

/**
 * 把写入准备时的账号和单据范围锁定在一个句柄中。
 * @param options 当前账号、本轮列表查询、草稿和刷新依赖。
 * @returns 持续校验账号和列表成员的安全访问句柄。
 * @throws 无预期错误。
 */
export function createTicketWriteAccess(options: {
  access: TicketAccess;
  getListedTicket: () => TicketListItem | undefined;
  draft: TicketDraftAccess;
  peekApproval: () => TicketApprovalPreview;
  peekDetail: () => TicketDetailSnapshot | undefined;
  refresh: TicketDetailUpdate;
}): TicketWriteAccess {
  const { access, getListedTicket, draft, peekApproval, peekDetail, refresh } = options;
  const getTicket = (): TicketListItem | undefined =>
    access.signal.aborted ? undefined : getListedTicket();

  return {
    ...access,
    getTicket,
    peekApproval,
    peekDetail: () => (getTicket() ? peekDetail() : undefined),
    getDraft: () => draft.read()?.text,
    clearDraft: (expected) => {
      // 执行期间用户可能改写了草稿；只清理执行开始时绑定的原文本。
      if (expected !== undefined && draft.read()?.text === expected) draft.save({ text: '' });
    },
    refresh: (refreshOptions) =>
      getTicket()
        ? refresh(refreshOptions)
        : Promise.resolve(
            createTicketDetailSnapshotFailure(
              access.signal.aborted ? 'connection-required' : 'not-found',
            ),
          ),
  };
}
