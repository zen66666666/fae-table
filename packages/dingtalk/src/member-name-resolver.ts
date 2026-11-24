// 在单个读取器内合并并缓存成员姓名查询，只保留 ID 到姓名的映射，不保存通讯录详情。
import type { Run } from './common.ts';
import { CONTACT_NAME_BATCH_SIZE, isContactUserId } from './contact-policy.ts';
import { readMemberNames } from './member-names.ts';

/** 同时完成的详情为姓名补查合并批次的等待时间，单位毫秒。 */
export const MEMBER_NAME_BATCH_DELAY_MS = 50;

/**
 * 根据已知成员 ID 获取显示姓名，供详情投影注入替换。
 * @param userIds 从单据中收集的成员 ID，不接受姓名搜索条件。
 * @returns 只含成功解析的 ID 与姓名；未知成员继续使用原有匿名显示。
 * @throws 默认实现不抛错；注入实现的错误由详情入口降级处理。
 */
export type MemberNameResolver = (
  userIds: readonly string[],
) => Promise<ReadonlyMap<string, string>>;

/** 一批姓名解析的当前无日志执行器与已核实账号；参数不发送网页。 */
export type MemberNameQuery = {
  userIds: readonly string[];
  run: Run;
  profile: string;
};

/** 姓名批次的环境依赖；默认在短暂合并窗口后调度，可替换为受控调度器。 */
export type MemberNameResolverOptions = { schedule?: (callback: () => void) => void };

/** 私有姓名缓存入口；invalidate 在登录、账号或连接变化时清空且阻止旧结果回填。 */
export type MemberNameCache = {
  resolve: (query: MemberNameQuery) => Promise<ReadonlyMap<string, string>>;
  invalidate: () => void;
};

type PendingName = {
  userId: string;
  run: Run;
  profile: string;
  promise: Promise<void>;
  finish: () => void;
};

class MemberNameBatcher {
  private names = new Map<string, string>();
  private pending = new Map<string, PendingName>();
  private queued: PendingName[] = [];
  private revision = 0;
  private profile: string | undefined;
  private isScheduled = false;
  private schedule: (callback: () => void) => void;

  constructor(options: MemberNameResolverOptions) {
    this.schedule =
      options.schedule ?? ((callback) => void setTimeout(callback, MEMBER_NAME_BATCH_DELAY_MS));
  }

  invalidate(): void {
    this.revision++;
    this.names.clear();
    // 已排队调用也必须及时完成，避免账号切换后页面继续等待旧账号姓名。
    for (const entry of this.pending.values()) entry.finish();
    this.pending.clear();
    this.queued = [];
    this.isScheduled = false;
    this.profile = undefined;
  }

  async resolve(query: MemberNameQuery): Promise<ReadonlyMap<string, string>> {
    // 1. 核对缓存账号；2. 合并未知 ID；3. 返回这次请求对应的安全姓名映射。
    // 1. 不同账号即使 userId 相同也不能共享映射。
    if (this.profile !== query.profile) {
      this.invalidate();
      this.profile = query.profile;
    }
    const revision = this.revision;
    const userIds = [...new Set(query.userIds.filter(isContactUserId))];
    // 2. 同一个 ID 的并发详情等待同一个查询，不重复启动 CLI。
    const pending = userIds
      .filter((userId) => !this.names.has(userId))
      .map((userId) => this.enqueue({ run: query.run, profile: query.profile, userId }));
    this.scheduleBatch();
    await Promise.all(pending);
    // 3. 失效前的调用不能读取新账号后来填入的缓存。
    if (this.revision !== revision) return new Map();
    return new Map(
      userIds.flatMap((userId) => {
        const name = this.names.get(userId);
        return name === undefined ? [] : [[userId, name] as const];
      }),
    );
  }

  private enqueue(query: Omit<MemberNameQuery, 'userIds'> & { userId: string }): Promise<void> {
    const existing = this.pending.get(query.userId);
    if (existing) return existing.promise;
    let finish!: () => void;
    const promise = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entry = { ...query, promise, finish };
    this.pending.set(query.userId, entry);
    this.queued.push(entry);
    return entry.promise;
  }

  private scheduleBatch(): void {
    if (this.isScheduled || this.queued.length === 0) return;
    this.isScheduled = true;
    const revision = this.revision;
    try {
      this.schedule(() => {
        if (revision !== this.revision) return;
        this.isScheduled = false;
        const batch = this.queued;
        this.queued = [];
        void this.readBatches(batch, revision);
      });
    } catch {
      // 调度器不可用时同样降级，姓名补全不能让详情永久挂起。
      this.invalidate();
    }
  }

  private async readBatches(entries: PendingName[], revision: number): Promise<void> {
    for (let offset = 0; offset < entries.length; offset += CONTACT_NAME_BATCH_SIZE) {
      if (revision !== this.revision) return;
      const batch = entries.slice(offset, offset + CONTACT_NAME_BATCH_SIZE);
      const names = await readMemberNames({
        run: batch[0].run,
        profile: batch[0].profile,
        userIds: batch.map((entry) => entry.userId),
      });
      if (revision !== this.revision) return;
      for (const entry of batch) {
        const name = names.get(entry.userId);
        if (name !== undefined) this.names.set(entry.userId, name);
        this.pending.delete(entry.userId);
        entry.finish();
      }
    }
  }
}

/**
 * 创建可跨并发详情合并的私有姓名缓存，默认每批最多查询二十人。
 * @param options 可替换批次调度，不触碰文件或凭据。
 * @returns 解析和失效入口；通讯录失败只返回缺失映射，不打印原始错误。
 * @throws 无预期错误。
 */
export function createMemberNameResolver(options: MemberNameResolverOptions = {}): MemberNameCache {
  const batcher = new MemberNameBatcher(options);
  return { resolve: batcher.resolve.bind(batcher), invalidate: batcher.invalidate.bind(batcher) };
}
