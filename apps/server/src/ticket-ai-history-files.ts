// 限定单据 AI 记录的文件名、磁盘用量和保留期，供本机加密存储使用。
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import {
  readOptionalTextFile,
  removeOptionalFile,
  writeAtomicTextFile,
} from '../../../packages/core/src/index.ts';
import type { TextFileSystem } from '../../../packages/core/src/index.ts';

const LEGACY_PREFIX = 'ai-history-v1-';
const PREFIX = 'ai-history-v2-';
const EXTENSION = '.dpapi';
const DIGEST = /^[a-f\d]{64}$/u;
const SCOPED_DIGEST = /^[a-f\d]{64}-[a-f\d]{64}$/u;
const TEMPORARY_SUFFIX = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}\.tmp$/u;
/** 单据持续未出现时的历史保留期，磁盘和内存使用相同计时。 */
export const AI_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_STORAGE_BYTES = 16 * 1024 * 1024;
const ENCRYPTED_RECORD = /^[A-Za-z\d+/]+={0,2}$/u;

/** 单张单据密文和 DPAPI 编解码的大小上限。 */
export const AI_HISTORY_FILE_BYTES = 2 * 1024 * 1024;

/** AI 历史使用的可替换本机文件操作。 */
export type TicketAiHistoryFileSystem = TextFileSystem &
  Pick<typeof fs, 'lstatSync' | 'readdirSync' | 'utimesSync'>;

type RecordFile = { key: string; filename: string; bytes: number; seenAt: number; usedAt: number };
type Eviction = (key: string) => void;

/**
 * 从已核实账号范围得到可分组的散列。
 * @param scope 后台已核实的账号范围。
 * @returns 不包含原始账号标识的文件分组键。
 * @throws 无预期错误。
 */
export function getTicketAiHistoryScope(scope: string): string {
  return createHash('sha256').update(scope).digest('hex');
}

/**
 * 获得与旧版密文绑定及文件名兼容的单据键。
 * @param key 旧或新格式的固定散列文件键。
 * @returns 对应同一单据的旧格式散列。
 * @throws 无预期错误。
 */
export function getLegacyTicketAiHistoryKey(key: string): string {
  return key.slice(key.lastIndexOf('-') + 1);
}

/**
 * 将现有账号范围与单据标识组合为固定文件键。
 * @param scope 钉钉已核实的本机账号范围。
 * @param id 通过单据列表门禁的标识。
 * @returns 不含原始账号或单据标识的 SHA-256 文件键。
 * @throws 无预期错误。
 */
export function getTicketAiHistoryKey(scope: string, id: string): string {
  const ticketKey = createHash('sha256')
    .update(JSON.stringify([scope, id]))
    .digest('hex');
  return getTicketAiHistoryScope(scope) + '-' + ticketKey;
}

function getRecordKey(name: string, prefix: string): string | undefined {
  if (!name.startsWith(prefix)) return undefined;
  const key = name.slice(prefix.length);
  const pattern = prefix === PREFIX ? SCOPED_DIGEST : DIGEST;
  return pattern.test(key) ? key : undefined;
}

/** 只操作运行目录中符合固定名字和文件类型的 AI 记录。 */
export class TicketAiHistoryFiles {
  private readonly directory: string;
  private readonly files: TicketAiHistoryFileSystem;

  /**
   * 绑定运行数据目录和文件依赖。
   * @param directory 已创建的绝对运行数据目录。
   * @param fileSystem 用于读写、清理和时间标记的文件操作。
   * @throws 无预期错误。
   */
  constructor(directory: string, fileSystem: TicketAiHistoryFileSystem = fs) {
    this.directory = directory;
    this.files = fileSystem;
  }

  private getFilename(key: string): string {
    if (SCOPED_DIGEST.test(key)) return path.join(this.directory, PREFIX + key + EXTENSION);
    if (DIGEST.test(key)) return path.join(this.directory, LEGACY_PREFIX + key + EXTENSION);
    throw new Error('invalid_history_key');
  }

  private getFile(key: string): RecordFile | undefined {
    const filename = this.getFilename(key);
    const info = this.files.lstatSync(filename, { throwIfNoEntry: false });
    if (!info) return undefined;
    // 不读取或替换链接、目录等其他文件，避免碰到本模块路径之外的内容。
    if (!info.isFile()) throw new Error('invalid_history_file');
    return { key, filename, bytes: info.size, seenAt: info.mtimeMs, usedAt: info.atimeMs };
  }

  private list(): RecordFile[] {
    return this.files.readdirSync(this.directory, { withFileTypes: true }).flatMap((item) => {
      if (!item.isFile() || !item.name.endsWith(EXTENSION)) return [];
      const stem = item.name.slice(0, -EXTENSION.length);
      const key = getRecordKey(stem, PREFIX) ?? getRecordKey(stem, LEGACY_PREFIX);
      const record = key ? this.getFile(key) : undefined;
      return record ? [record] : [];
    });
  }

  /**
   * 清理异常退出留下的密文临时文件。
   * @returns 无返回值；已有对话记录保持原样，直到完整列表确认可清理。
   * @throws 无法读取目录或删除临时文件时抛错。
   */
  removeOrphanTemps(): void {
    for (const item of this.files.readdirSync(this.directory, { withFileTypes: true })) {
      if (!item.isFile()) continue;
      const separator = EXTENSION + '.';
      const index = item.name.indexOf(separator);
      if (index < 0 || !TEMPORARY_SUFFIX.test(item.name.slice(index + separator.length))) continue;
      const stem = item.name.slice(0, index);
      if (!getRecordKey(stem, PREFIX) && !getRecordKey(stem, LEGACY_PREFIX)) continue;
      // 这里只处理原子写入命名的残留文件，不能因为长时间未启动删掉可恢复的历史。
      removeOptionalFile({
        filename: path.join(this.directory, item.name),
        fileSystem: this.files,
      });
    }
  }

  /**
   * 更新完整列表中仍存在的记录时间，清理同账号已不在列表里的过期文件。
   * @param options 当前时间、账号和列表文件键、是否只能登录一个账号，以及删除回调。
   * @returns 无返回值，并通过回调同步失效已删除的内存记录。
   * @throws 无法读取或整理本机文件时抛错。
   */
  maintainRecent(options: {
    now: number;
    scope: string;
    recent: ReadonlySet<string>;
    isOnlyProfile: boolean;
    onRemove: Eviction;
  }): void {
    // 1. 迁移已匹配的旧记录。2. 更新现有记录的出现时间。3. 只删除已确定离开列表的过期记录。
    const { now, scope, recent, isOnlyProfile, onRemove } = options;
    const legacy = new Map([...recent].map((key) => [getLegacyTicketAiHistoryKey(key), key]));
    for (const file of this.list()) {
      const newKey = legacy.get(file.key);
      if (newKey) this.migrate(file, newKey); // 1.
      const isInScope =
        file.key.startsWith(scope + '-') || (isOnlyProfile && DIGEST.test(file.key));
      if (newKey || recent.has(file.key)) {
        const current = newKey ? this.getFile(newKey) : file;
        if (current) this.files.utimesSync(current.filename, current.usedAt / 1_000, now / 1_000); // 2.
      } else if (isInScope && now - file.seenAt >= AI_HISTORY_RETENTION_MS) {
        // 旧格式未记账号；多账号时未匹配的记录无法判断归属，不作过期删除。
        this.removeFile(file.key); // 3.
        onRemove(file.key);
      }
    }
  }

  private migrate(file: RecordFile, key: string): void {
    if (this.getFile(key)) this.removeFile(file.key);
    else this.files.renameSync(file.filename, this.getFilename(key));
  }

  /**
   * 由最久未用起腾出接下来一次写入需要的磁盘空间。
   * @param options 写入键、密文字节数及删除回调。
   * @returns 无返回值；不会根据出现时间删除尚有空间的记录。
   * @throws 密文超限或无法读取及删除磁盘文件时抛错。
   */
  reserve(options: { key: string; bytes: number; onRemove: Eviction }): void {
    const { key, bytes: incoming, onRemove } = options;
    if (incoming > AI_HISTORY_FILE_BYTES) throw new Error('history_file_too_large');
    const previous = getLegacyTicketAiHistoryKey(key);
    const active = this.list().filter((file) => file.key !== key && file.key !== previous);
    let bytes = active.reduce((sum, file) => sum + file.bytes, incoming);
    if (bytes <= MAX_STORAGE_BYTES) return;
    for (const file of active.sort((a, b) => a.usedAt - b.usedAt || a.seenAt - b.seenAt)) {
      this.removeFile(file.key);
      onRemove(file.key);
      bytes -= file.bytes;
      if (bytes <= MAX_STORAGE_BYTES) return;
    }
  }

  /**
   * 读取符合限额的当前密文，并更新最近使用时间。
   * @param key 单据的散列文件键。
   * @param now 当前时钟毫秒数。
   * @returns 现有密文，未保存时为 null。
   * @throws 文件读取或格式检查失败。
   */
  read(key: string, now: number): string | null {
    const file = this.getFile(key) ?? this.getFile(getLegacyTicketAiHistoryKey(key));
    if (!file) return null;
    if (file.bytes > AI_HISTORY_FILE_BYTES) throw new Error('history_file_too_large');
    const text = readOptionalTextFile({ filename: file.filename, fileSystem: this.files });
    if (text === null) return null;
    if (!ENCRYPTED_RECORD.test(text)) throw new Error('invalid_history_file');
    // 只改变最近使用时间，不把磁盘读取误当作单据在列表里持续出现。
    try {
      this.files.utimesSync(file.filename, now / 1_000, file.seenAt / 1_000);
    } catch {
      // 无法更新时间仍可读取已保存的问答。后续写入失败会单独报告。
    }
    return text;
  }

  /**
   * 用受保护的字符串原子替换同一条记录。
   * @param options 文件键、已加密的文字及当前时钟。
   * @returns 原子替换完成后无返回值。
   * @throws 密文无效、超限或文件无法安全写入时抛错。
   */
  write(options: { key: string; text: string; now: number }): void {
    const { key, text, now } = options;
    if (text.length > AI_HISTORY_FILE_BYTES || !ENCRYPTED_RECORD.test(text))
      throw new Error('invalid_history_ciphertext');
    const legacy = SCOPED_DIGEST.test(key)
      ? this.getFile(getLegacyTicketAiHistoryKey(key))
      : undefined;
    // 先保留旧密文到新位置；后续原子写入失败时仍可恢复，磁盘也不会留下两份。
    if (legacy) this.migrate(legacy, key);
    this.getFile(key);
    const filename = this.getFilename(key);
    writeAtomicTextFile({ filename, fileSystem: this.files, text });
    this.files.utimesSync(filename, now / 1_000, now / 1_000);
  }

  /**
   * 删除当前单据的密文文件，不触及其他记录。
   * @param key 单据的散列文件键。
   * @returns 文件不存在或删除完成后无返回值。
   * @throws 文件类型异常或删除失败。
   */
  remove(key: string): void {
    if (SCOPED_DIGEST.test(key)) this.removeFile(getLegacyTicketAiHistoryKey(key));
    this.removeFile(key);
  }

  private removeFile(key: string): void {
    const file = this.getFile(key);
    if (file) removeOptionalFile({ filename: file.filename, fileSystem: this.files });
  }
}
