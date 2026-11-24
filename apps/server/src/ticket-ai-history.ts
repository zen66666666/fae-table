// 管理按账号与单据隔离的加密历史及内存回退，供单据 AI 服务使用。
import { AI_CHAT_HISTORY_LIMIT, isAiModel, isObject } from '../../../packages/core/src/index.ts';
import type {
  AiChatHistory,
  AiChatTurn,
  TicketListItem,
} from '../../../packages/core/src/index.ts';
import type { createDpapiProtection } from '../../../packages/ai/src/index.ts';
import {
  AI_HISTORY_RETENTION_MS,
  getLegacyTicketAiHistoryKey,
  getTicketAiHistoryKey,
  getTicketAiHistoryScope,
  TicketAiHistoryFiles,
} from './ticket-ai-history-files.ts';

const MAX_CACHE_TICKETS = 128;

type Entry = AiChatHistory & { isUnreadable?: true };
type Cache = { entry: Entry; seenAt: number };
type StoredTurn = Omit<AiChatTurn, 'model'> & { model?: unknown };

function isTurn(value: unknown): value is StoredTurn {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.question === 'string' &&
    typeof value.answer === 'string' &&
    isObject(value.summary) &&
    Number.isInteger(value.summary.recordCount) &&
    Number.isInteger(value.summary.fieldCount) &&
    Number.isInteger(value.summary.researcherCount) &&
    Array.isArray(value.summary.manualPages) &&
    (value.outcome === 'complete' || value.outcome === 'truncated')
  );
}

function readTurnModel(turn: StoredTurn): AiChatTurn {
  // 模型是后来新增的可选信息；旧记录没有模型，单个异常值也不能使整张单据的历史失效。
  const { model, ...record } = turn;
  return isAiModel(model) ? { ...record, model } : record;
}

function projectHistory(entry: Entry): AiChatHistory {
  return { turns: entry.turns, isSaveFailed: entry.isSaveFailed };
}

/** 单据历史使用串行磁盘队列，同一条记录的保存、恢复和清空不会相互覆盖。 */
export class TicketAiHistory {
  private readonly files: TicketAiHistoryFiles;
  private readonly protection: ReturnType<typeof createDpapiProtection>;
  private readonly now: () => number;
  private readonly memory = new Map<string, Cache>();
  private queue = Promise.resolve();

  /**
   * 创建加密历史并删除上次异常退出留下的临时文件。
   * @param options 可替换的文件操作、DPAPI 和当前时钟。
   * @throws 无预期错误；临时文件清理故障不会阻止启动。
   */
  constructor(options: {
    files: TicketAiHistoryFiles;
    protection: ReturnType<typeof createDpapiProtection>;
    now: () => number;
  }) {
    this.files = options.files;
    this.protection = options.protection;
    this.now = options.now;
    void this.enqueue(() => this.files.removeOrphanTemps()).catch(() => {});
  }

  private enqueue<T>(run: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private forgetSaved(key: string): void {
    for (const [cachedKey, cache] of this.memory) {
      const isRemoved = cachedKey === key || getLegacyTicketAiHistoryKey(cachedKey) === key;
      if (isRemoved && !cache.entry.isSaveFailed) this.memory.delete(cachedKey);
    }
  }

  /**
   * 完整读到当前账号的列表后，更新现有记录并清理该范围内过期且已不在列表的记录。
   * @param options 已核实的账号范围、已发布的完整列表、是否仅有当前账号。
   * @returns 无返回值，整理文件在后台队列执行。
   * @throws 无预期错误。
   */
  noteRecent(options: {
    scope: string;
    items: readonly TicketListItem[];
    isOnlyProfile: boolean;
  }): void {
    // 1. 更新当前列表的记录日期。2. 清理本账号已离开列表的过期记录。
    const { scope, items, isOnlyProfile } = options;
    const scopeKey = getTicketAiHistoryScope(scope);
    const recent = new Set(items.map(({ id }) => getTicketAiHistoryKey(scope, id)));
    void this.enqueue(() => {
      const now = this.now();
      for (const [key, cached] of this.memory) {
        if (recent.has(key))
          cached.seenAt = now; // 1.
        else if (key.startsWith(scopeKey + '-') && now - cached.seenAt >= AI_HISTORY_RETENTION_MS)
          this.memory.delete(key); // 2.
      }
      this.files.maintainRecent({
        now,
        recent,
        scope: scopeKey,
        isOnlyProfile,
        onRemove: (key) => this.forgetSaved(key),
      });
    }).catch(() => {});
  }

  private remember(key: string, entry: Entry): void {
    this.memory.delete(key);
    this.memory.set(key, { entry, seenAt: this.now() });
    // 优先腾出能从盘中重读的缓存，失败的内存记录保留到原有内存上限。
    if (this.memory.size <= MAX_CACHE_TICKETS) return;
    const oldest =
      [...this.memory].find(([id, saved]) => id !== key && !saved.entry.isSaveFailed)?.[0] ??
      this.memory.keys().next().value;
    if (oldest !== undefined) this.memory.delete(oldest);
  }

  private async load(key: string): Promise<Entry> {
    const cached = this.memory.get(key)?.entry;
    if (cached?.isSaveFailed && !cached.isUnreadable) return cached;
    try {
      const ciphertext = this.files.read(key, this.now());
      if (cached && !cached.isUnreadable && ciphertext) return cached;
      if (ciphertext === null) return { turns: cached?.isUnreadable ? cached.turns : [] };
      const decoded: unknown = JSON.parse(await this.protection.unprotect(ciphertext));
      // 同一系统用户可读取各账号密文，文件内部仍核对派生键，避免拷贝或改名造成串用。
      if (
        !isObject(decoded) ||
        decoded.key !== getLegacyTicketAiHistoryKey(key) ||
        !Array.isArray(decoded.turns) ||
        !decoded.turns.every(isTurn)
      )
        throw new Error('invalid_history');
      const stored = new Map(decoded.turns.map((turn) => [turn.id, readTurnModel(turn)]));
      for (const turn of cached?.turns ?? []) if (!stored.has(turn.id)) stored.set(turn.id, turn);
      return {
        turns: [...stored.values()].slice(-AI_CHAT_HISTORY_LIMIT),
        isSaveFailed: cached?.isSaveFailed,
      };
    } catch {
      // 无法解密旧记录时用内存继续，禁止用空历史覆盖可能还能恢复的旧密文。
      return { turns: cached?.turns ?? [], isSaveFailed: true, isUnreadable: true };
    }
  }

  /**
   * 恢复本单已有问答，并投影可公开的保存状态。
   * @param key 由本机账号和单据派生的文件键。
   * @returns 本机历史和可选的固定保存失败标志。
   * @throws 无预期错误；读取失败降级到内存。
   */
  read(key: string): Promise<AiChatHistory> {
    return this.enqueue(async () => {
      const entry = await this.load(key);
      this.remember(key, entry);
      return projectHistory(entry);
    });
  }

  /**
   * 读取后台正在回答时已经加载的历史，免去等待其他单据的加密写入。
   * @param key 由当前账号和单据派生的历史键。
   * @returns 已缓存的历史，首次尚未加载时为 undefined。
   * @throws 无预期错误。
   */
  peek(key: string): AiChatHistory | undefined {
    const entry = this.memory.get(key)?.entry;
    return entry && projectHistory(entry);
  }

  /**
   * 保存一轮可继续使用的问答；失败时仍保留该问答。
   * @param key 已授权单据的派生文件键。
   * @param turn 已过滤可保存的完整或截断问答。
   * @returns 写入成功情况，供流末尾报告。
   * @throws 无预期错误；加密或文件故障转成保存失败。
   */
  append(key: string, turn: AiChatTurn): Promise<boolean> {
    return this.enqueue(async () => {
      // 1. 取得最新历史。2. 先加密并确认磁盘容量。3. 原子写入或回退到内存。
      const old = await this.load(key); // 1.
      const turns = [...old.turns, readTurnModel(turn)].slice(-AI_CHAT_HISTORY_LIMIT);
      try {
        if (old.isUnreadable) throw new Error('history_unavailable');
        const stored = { key: getLegacyTicketAiHistoryKey(key), turns };
        const text = await this.protection.protect(JSON.stringify(stored)); // 2.
        const now = this.now();
        this.files.reserve({
          key,
          bytes: Buffer.byteLength(text),
          onRemove: (removed) => this.forgetSaved(removed),
        });
        this.files.write({ key, text, now }); // 3.
        this.remember(key, { turns });
        return true;
      } catch {
        this.remember(key, { turns, isSaveFailed: true, isUnreadable: old.isUnreadable });
        return false;
      }
    });
  }

  /**
   * 清空当前单据的问答，用内存空记录遮住暂时无法删除的旧密文。
   * @param key 已授权单据的派生文件键。
   * @returns 空历史和可选的磁盘失败标志。
   * @throws 无预期错误；删除失败时提示保存失败。
   */
  clear(key: string): Promise<AiChatHistory> {
    return this.enqueue(() => {
      let isSaveFailed: true | undefined;
      try {
        this.files.remove(key);
      } catch {
        isSaveFailed = true;
      }
      const history = { turns: [], isSaveFailed };
      this.remember(key, history);
      return history;
    });
  }

  /**
   * 退出时等待已接收的保存与清理任务结束。
   * @returns 队列完成后返回。
   * @throws 无预期错误。
   */
  waitForIdle(): Promise<void> {
    return this.queue;
  }
}
