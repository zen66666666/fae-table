// 读取并原子维护本机资料索引，保存最小文件元数据和已核实的型号对应关系。
import path from 'node:path';
import { isObject, readOptionalTextFile, writeAtomicTextFile } from '../../core/src/index.ts';
import type { ManualLookupResult, ManualMatch, TextFileSystem } from '../../core/src/index.ts';
import { MANUAL_NAME_MAX_LENGTH } from './constants.ts';
import { assertManualStoreActive, ManualDownloadError } from './download-error.ts';
import { isSavedFileName } from './file-name.ts';
import { createManualMatch, getManualSearchUrl, isManualProductId } from './links.ts';
import { getManualBaseModel, normalizeManualModel } from './model.ts';
import { MANUAL_PDF_LIMIT_BYTES } from './pdf-request.ts';
import { PDF_SHA256_PATTERN } from './read-pdf-input.ts';
import { isSameManualPath } from './store-files.ts';

const INDEX_FILE = 'manual-downloads.json';
const INDEX_VERSION = 2;
const LEGACY_INDEX_VERSION = 1;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const UNSAFE_NAME_TEXT = /[\x00-\x1f\x7f-\x9f]/gu;

/** 本机已存手册的相对文件名、官网编号、校验与完成时间。 */
export type ManualStoredEntry = {
  productId: string;
  fileName: string;
  size: number;
  sha256: string;
  downloadedAt: string;
};

/** 已核实官网型号与最小公开元数据，不存 URL。 */
export type StoredManualMatch = Pick<ManualMatch, 'productId' | 'model' | 'name' | 'kind'>;

type IndexState = {
  directory?: string;
  files: Map<string, ManualStoredEntry>;
  models: Map<string, StoredManualMatch>;
};
type StoredLookup = Extract<ManualLookupResult, { kind: 'found' }>;

function readFileMetadata(productId: string, value: unknown): ManualStoredEntry | undefined {
  if (!isObject(value) || !isManualProductId(productId)) return undefined;
  const { fileName, size, sha256, downloadedAt } = value;
  if (
    typeof fileName !== 'string' ||
    !isSavedFileName(fileName) ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 5 ||
    size > MANUAL_PDF_LIMIT_BYTES ||
    typeof sha256 !== 'string' ||
    !PDF_SHA256_PATTERN.test(sha256) ||
    typeof downloadedAt !== 'string' ||
    !DATE_PATTERN.test(downloadedAt) ||
    !Number.isFinite(Date.parse(downloadedAt))
  )
    return undefined;
  return { productId, fileName, size, sha256, downloadedAt };
}

/**
 * 校验查询型号与已核实产品元数据是否符合唯一允许的匹配规则。
 * @param query 已规范化的原查询型号。
 * @param value 查询结果或运行时索引中的候选元数据。
 * @returns 可持久化的最小元数据，非法记录返回 undefined。
 * @throws 无预期错误。
 */
export function readManualMetadata(query: string, value: unknown): StoredManualMatch | undefined {
  if (normalizeManualModel(query) !== query || !isObject(value)) return undefined;
  const { productId, model, name, kind } = value;
  if (
    typeof productId !== 'string' ||
    !isManualProductId(productId) ||
    typeof model !== 'string' ||
    normalizeManualModel(model) !== model ||
    typeof name !== 'string' ||
    (kind !== 'exact' && kind !== 'without-suffix')
  ) {
    return undefined;
  }
  if (model !== (kind === 'exact' ? query : getManualBaseModel(query))) return undefined;
  const safeName =
    name.replace(UNSAFE_NAME_TEXT, '').trim().slice(0, MANUAL_NAME_MAX_LENGTH) || model;
  return { productId, model, name: safeName, kind };
}

function readIndex(text: string | null): IndexState {
  const files = new Map<string, ManualStoredEntry>();
  const models = new Map<string, StoredManualMatch>();
  if (text === null) return { files, models };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { files, models };
  }
  if (
    !isObject(value) ||
    (value.version !== INDEX_VERSION && value.version !== LEGACY_INDEX_VERSION)
  ) {
    return { files, models };
  }
  const directory =
    value.version === INDEX_VERSION &&
    typeof value.directory === 'string' &&
    path.isAbsolute(value.directory) &&
    !value.directory.includes('\0')
      ? value.directory
      : undefined;
  // 旧版仅记录文件名与大小，没有目录归属，不能借旧索引把新目录中的同名文件当成手册。
  if (directory && isObject(value.files)) {
    for (const [id, row] of Object.entries(value.files)) {
      const file = readFileMetadata(id, row);
      if (file) files.set(id, file);
    }
  }
  for (const [query, row] of Object.entries(isObject(value.models) ? value.models : {})) {
    const match = readManualMetadata(query, row);
    if (match) models.set(query, match);
  }
  return { directory, files, models };
}

function isSameMatch(left: StoredManualMatch | undefined, right: StoredManualMatch): boolean {
  return (
    left?.productId === right.productId &&
    left.model === right.model &&
    left.name === right.name &&
    left.kind === right.kind
  );
}

/** 一个后台实例维护的资料索引，读写不暴露运行目录与原始异常。 */
export class ManualStoreIndex {
  private readonly filename: string;
  private readonly fileSystem?: TextFileSystem;
  private readonly signal?: AbortSignal;
  private state?: IndexState;

  /**
   * 创建运行数据目录下的索引对象，首读时载入内容。
   * @param options 运行数据目录、范围停止信号与可替换配置文件操作。
   * @throws 无预期错误。
   */
  constructor(options: { dataDir: string; fileSystem?: TextFileSystem; signal?: AbortSignal }) {
    this.filename = path.join(options.dataDir, INDEX_FILE);
    this.fileSystem = options.fileSystem;
    this.signal = options.signal;
  }

  private getState(): IndexState {
    this.state ??= this.readState();
    return this.state;
  }

  private readState(): IndexState {
    try {
      return readIndex(
        readOptionalTextFile({ filename: this.filename, fileSystem: this.fileSystem }),
      );
    } catch {
      throw new ManualDownloadError('storage');
    }
  }

  private writeState(state: IndexState): void {
    assertManualStoreActive(this.signal);
    if (!state.directory) throw new ManualDownloadError('storage');
    try {
      writeAtomicTextFile({
        filename: this.filename,
        fileSystem: this.fileSystem,
        text: JSON.stringify({
          version: INDEX_VERSION,
          directory: state.directory,
          files: Object.fromEntries(state.files),
          models: Object.fromEntries(state.models),
        }),
      });
      this.state = state;
    } catch {
      throw new ManualDownloadError('storage');
    }
  }

  /**
   * 按核实的实际路径绑定索引，目录变化时只作废原文件条目。
   * @param directory 已验证且固定的实际目录。
   * @returns 无返回值；原文件与所有合法型号对应关系均保留。
   * @throws ManualDownloadError 索引不可写或存储范围已经停止。
   */
  bindDirectory(directory: string): void {
    assertManualStoreActive(this.signal);
    // 旧范围任务已经清理后重新读取磁盘，避免使用切换时较早载入的状态。
    const latest = this.readState();
    if (latest.directory && isSameManualPath(latest.directory, directory)) {
      this.state = latest;
    } else {
      this.writeState({ ...latest, directory, files: new Map() });
    }
  }

  /**
   * 返回已索引文件元数据，调用前后的本机大小验证由存储服务负责。
   * @param productId 已核实官网编号。
   * @returns 当前条目，索引未记录时返回 undefined。
   * @throws ManualDownloadError 索引无法读取。
   */
  getFile(productId: string): ManualStoredEntry | undefined {
    return this.getState().files.get(productId);
  }

  /**
   * 只读查找属于已核实实际目录的 PDF 条目，预热不绑定目录或写索引。
   * @param options 已核实官网编号与实际目录。
   * @returns 当前目录中已索引条目，缺失或目录不符时返回 undefined。
   * @throws ManualDownloadError 索引无法读取。
   */
  getFileAtDirectory(options: {
    productId: string;
    directory: string;
  }): ManualStoredEntry | undefined {
    const state = this.getState();
    if (!state.directory || !isSameManualPath(options.directory, state.directory)) return undefined;
    return state.files.get(options.productId);
  }

  /**
   * 读取运行时索引中此前已确认的官网匹配，以支持重启后离线打开。
   * @param query 已规范化查询型号。
   * @returns 已验证的元数据，未存时为 undefined。
   * @throws ManualDownloadError 索引无法读取。
   */
  getMatch(query: string): StoredManualMatch | undefined {
    return this.getState().models.get(query);
  }

  /**
   * 原子发布元数据和型号映射；失败时不回滚删除已完整发布的 PDF。
   * @param options 本次查询型号、已验证匹配和物理文件元数据。
   * @returns 无返回值。
   * @throws ManualDownloadError 索引无法保存。
   */
  save(options: { query: string; match: StoredManualMatch; entry: ManualStoredEntry }): void {
    const state = this.getState();
    const { query, match, entry } = options;
    if (state.files.get(entry.productId) === entry && isSameMatch(state.models.get(query), match))
      return;
    this.writeState({
      ...state,
      files: new Map(state.files).set(entry.productId, entry),
      models: new Map(state.models).set(query, match),
    });
  }

  /**
   * 在复用已验证文件时补记查询别名，不改变已有文件元数据。
   * @param options 实际查询型号及其已验证匹配。
   * @returns 无返回值。
   * @throws ManualDownloadError 索引无法保存。
   */
  saveMatch(options: { query: string; match: StoredManualMatch }): void {
    const state = this.getState();
    const { query, match } = options;
    if (isSameMatch(state.models.get(query), match)) return;
    this.writeState({ ...state, models: new Map(state.models).set(query, match) });
  }

  /**
   * 从索引中移除仍属于旧版本的文件信息；保留历史型号匹配与磁盘原件。
   * @param entry 经范围核实但已缺失或大小不一致的条目。
   * @returns 无返回值。
   * @throws ManualDownloadError 索引无法保存。
   */
  invalidate(entry: ManualStoredEntry): void {
    const state = this.getState();
    if (state.files.get(entry.productId) !== entry) return;
    // 异步文件检查之后才能得出失效结果，必须避免抹掉并行下载的新索引。
    const files = new Map(state.files);
    files.delete(entry.productId);
    this.writeState({ ...state, files });
  }
}

/**
 * 从索引中验证过的资料信息重建官网的固定外部链接。
 * @param query 用户单据中的已校验查询型号。
 * @param match 已验证的公开产品元数据。
 * @returns 与内存官网查询相同的命中契约。
 * @throws 无预期错误。
 */
export function restoreManualLookup(query: string, match: StoredManualMatch): StoredLookup {
  return {
    kind: 'found',
    match: createManualMatch(
      { id: match.productId, model: match.model, name: match.name },
      match.kind,
    ),
    searchUrl: getManualSearchUrl(query).href,
  };
}
