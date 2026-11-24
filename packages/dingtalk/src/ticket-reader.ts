// 为一个后台实例提供连续单据读取，集中持有和作废身份缓存，不保存单据内容。
import {
  createTicketDetailFailure,
  createTicketListFailure,
  getDingtalkConnectionKey,
} from '../../core/src/index.ts';
import type { DingtalkStatus, TicketDetailResult, TicketListResult } from '../../core/src/index.ts';
import type { Run } from './common.ts';
import type { Identity } from './identity.ts';
import { TicketIdentityCache } from './ticket-identity.ts';
import { readTicketList } from './ticket-list.ts';
import { readTicketDetail } from './ticket-detail.ts';
import { createTicketImageKey } from './ticket-image-id.ts';
import { createMemberNameResolver } from './member-name-resolver.ts';
import type { MemberNameCache, MemberNameResolverOptions } from './member-name-resolver.ts';
import { createTicketRunner } from './ticket-options.ts';
import type { TicketReadOptions, TicketDetailOptions } from './ticket-options.ts';

/** 连续单据读取器；身份只存在内部缓存，invalidate 须在登录或连接状态变化时调用。 */
export type TicketReader = {
  listTickets: (options: TicketReadOptions) => Promise<TicketListResult>;
  getTicketDetail: (options: TicketDetailOptions) => Promise<TicketDetailResult>;
  invalidate: () => void;
};

/** 身份缓存的可替换毫秒时钟，以及姓名批次的可替换调度。 */
export type TicketReaderOptions = {
  now?: () => number;
  scheduleMemberNames?: MemberNameResolverOptions['schedule'];
};

type TicketReaderIdentity = {
  read: (options: { run: Run; connection: DingtalkStatus }) => Promise<Identity>;
  peek: (connection: DingtalkStatus) => Identity | undefined;
};

const READER_IDENTITIES = new WeakMap<TicketReader, TicketReaderIdentity>();

/**
 * 从单据读取器取得其身份缓存入口，只在钉钉模块内部使用。
 * @param reader 当前后台用于预读的读取器。
 * @returns 读取与仅查缓存的入口；替换读取器或未传入时可缺失。
 * @throws 无预期错误。
 */
export function getTicketReaderIdentity(reader?: TicketReader): TicketReaderIdentity | undefined {
  return reader && READER_IDENTITIES.get(reader);
}

function createCachedDetailReader(options: {
  names: MemberNameCache;
  resolveIdentity: TicketIdentityCache['getIdentity'];
  prepare: (connection: DingtalkStatus) => number;
  getRevision: () => number;
  getImageKey: () => Buffer;
}): TicketReader['getTicketDetail'] {
  return async (readOptions) => {
    const revision = options.prepare(readOptions.connection);
    const run = createTicketRunner(readOptions);
    const resolveMemberNames =
      readOptions.resolveMemberNames ??
      ((userIds: readonly string[]) =>
        options.getRevision() === revision
          ? options.names.resolve({
              userIds,
              run,
              profile: readOptions.connection.selectedProfile!,
            })
          : Promise.resolve(new Map<string, string>()));
    const result = await readTicketDetail(
      { ...readOptions, run, resolveMemberNames },
      { resolveIdentity: options.resolveIdentity, imageKey: options.getImageKey() },
    );
    return options.getRevision() === revision
      ? result
      : createTicketDetailFailure('connection-required');
  };
}

/**
 * 创建共享十分钟身份核验结果的读取器，每个后台实例单独持有。
 * @param options 可替换时钟，不接受或输出身份凭据。
 * @returns 列表、详情及缓存作废入口；方法返回值不包含 userId 或 corpId。
 * @throws 创建时无预期错误；读取错误由各方法转换为安全结果。
 */
export function createTicketReader(options: TicketReaderOptions = {}): TicketReader {
  const cache = new TicketIdentityCache(options.now);
  const names = createMemberNameResolver({ schedule: options.scheduleMemberNames });
  let revision = 0;
  let imageKey = createTicketImageKey();
  let connectionKey: string | undefined;
  const invalidate = (): void => {
    revision++;
    // 换账号、登出或重新登录后即使切回相同账号，也不能继续使用旧编号。
    imageKey = createTicketImageKey();
    cache.invalidate();
    names.invalidate();
  };
  const prepare = (connection: DingtalkStatus): number => {
    const key = getDingtalkConnectionKey(connection);
    if (connectionKey !== key) {
      invalidate();
      connectionKey = key;
    }
    return revision;
  };
  const resolveIdentity = cache.getIdentity.bind(cache);
  const reader: TicketReader = {
    invalidate,
    async listTickets(readOptions) {
      const currentRevision = prepare(readOptions.connection);
      const result = await readTicketList(readOptions, resolveIdentity);
      return revision === currentRevision ? result : createTicketListFailure('connection-required');
    },
    getTicketDetail: createCachedDetailReader({
      names,
      resolveIdentity,
      prepare,
      getRevision: () => revision,
      getImageKey: () => imageKey,
    }),
  };
  READER_IDENTITIES.set(reader, {
    read: ({ run, connection }) => {
      prepare(connection);
      return cache.getIdentity(run, connection.selectedProfile ?? undefined);
    },
    peek: (connection) => {
      // 后台核对必须使用同一已预读身份，因而不唤醒认证流程或切换账号。
      if (!connection.selectedProfile || connectionKey !== getDingtalkConnectionKey(connection))
        return undefined;
      return cache.peekIdentity(connection.selectedProfile);
    },
  });
  return reader;
}
