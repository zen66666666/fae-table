// 管理资料目录的后台检查和保存，协调手册目录与配置的切换。
import { AppError, isCatalogFolderReason } from '../../../packages/core/src/index.ts';
import type {
  CatalogFolderPickResult,
  CatalogStatus,
  CatalogWriteFailureReason,
} from '../../../packages/core/src/index.ts';
import { pickCatalogFolder } from './catalog-folder-picker.ts';
import { CatalogPdfCount } from './catalog-pdf-count.ts';
import {
  getCatalogPdfStats,
  getCatalogStatus,
  inspectCatalogFolder,
  saveCatalogFolder,
} from './catalog.ts';
import { ConnectionCache } from './connection-cache.ts';
import { createInitialCatalogStatus } from './connection-initial-state.ts';
import { CATALOG_LIGHT_CACHE_MS } from './constants.ts';
import type { ConnectionContext } from './types.ts';

type CatalogCheckpoint = CatalogStatus & { isPathReady?: boolean; hasProbed?: boolean };

function isWriteFailure(reason: CatalogStatus['reason']): reason is CatalogWriteFailureReason {
  return reason === 'folder-not-writable' || reason === 'folder-disk-full';
}

/** 资料目录连接；建议值只在网页预填，只有成功保存才开启手册目录。 */
export class CatalogConnection {
  private readonly context: ConnectionContext;
  private readonly applyFolder: (folder?: string) => Promise<void>;
  private readonly cache: ConnectionCache<CatalogCheckpoint>;
  private readonly pdfCount: CatalogPdfCount;
  private suggestion?: Promise<string | null>;
  private saving = Promise.resolve();
  private isCommitting = false;
  private isPickingFolder = false;
  private hasInspectionRequest = true;

  /**
   * 创建资料连接并安排初次检查；它不阻塞单据或钉钉连接。
   * @param context 当前后台配置、路径和可替换环境依赖。
   * @param applyFolder 将已核实的资料位置交给手册服务。
   * @throws 无预期错误。
   */
  constructor(context: ConnectionContext, applyFolder: (folder?: string) => Promise<void>) {
    this.context = context;
    this.applyFolder = applyFolder;
    const { dependencies, signal } = context;
    const timing = { now: dependencies.now, schedule: dependencies.schedule, signal };
    this.pdfCount = new CatalogPdfCount({
      ...timing,
      scan: (folder) => getCatalogPdfStats({ ...this.checkOptions(), folder }),
    });
    this.cache = new ConnectionCache<CatalogCheckpoint>({
      ...timing,
      initial: createInitialCatalogStatus(context.config.catalogFolder),
      cacheDurationMs: CATALOG_LIGHT_CACHE_MS,
      check: () => this.checkStatus(),
      onChange: (status) => this.applyCheckedStatus(status),
    });
    void this.cache.refresh();
  }

  private checkOptions(): Omit<Parameters<typeof getCatalogStatus>[0], 'folder'> {
    const { dataDir, environment, dependencies, signal } = this.context;
    return { dataDir, environment, signal, fileSystem: dependencies.catalogFileSystem };
  }

  private getSuggestedFolder(): Promise<string | null> {
    const { dependencies, environment, spawn, signal } = this.context;
    this.suggestion ??= dependencies
      .getManualsDirectory({ environment, spawn, signal })
      .catch(() => null);
    return this.suggestion;
  }

  private async checkStatus(): Promise<CatalogCheckpoint> {
    // 1. 用轻检查核对目录。2. 需要验证写入时只探测一次。3. 保留已知的写入失败。
    const previous = this.cache.peekSnapshot();
    const isInspectionRequested = this.hasInspectionRequest;
    this.hasInspectionRequest = false;
    const options = { ...this.checkOptions(), folder: this.context.config.catalogFolder };
    const [status, suggestedFolder] = await Promise.all([
      // 1.
      getCatalogStatus(options),
      this.getSuggestedFolder(),
    ]);
    if (status.state !== 'ready') return { ...status, suggestedFolder, isPathReady: false };
    if (isInspectionRequested || !previous.isPathReady) {
      const inspected = await inspectCatalogFolder(options); // 2.
      return {
        ...inspected,
        suggestedFolder,
        hasProbed: true,
        isPathReady: inspected.state === 'ready' || isWriteFailure(inspected.reason),
      };
    }
    // 3. 路径存在不能证明权限或空间已恢复，先等待重新保存、显式刷新或实际重新挂载。
    if (isWriteFailure(previous.reason)) return { ...previous, hasProbed: false };
    return { ...status, suggestedFolder, isPathReady: true };
  }

  private applyCheckedStatus(status: CatalogCheckpoint): void {
    if (this.isCommitting) return;
    const folder = this.getReadyFolder(status);
    void this.applyFolder(folder).catch(() => {});
    if (folder) this.pdfCount.schedule({ folder, isForced: status.hasProbed === true });
  }

  private getReadyFolder(status: CatalogStatus): string | undefined {
    return status.state === 'ready' ? (status.folder ?? undefined) : undefined;
  }

  /**
   * 读取资料目录摘要，等待读取过期元数据；计数始终独立。
   * @returns 当前保存地址、建议值、可用状态和 PDF 统计。
   * @throws 无预期错误。
   */
  async getSnapshot(): Promise<CatalogStatus> {
    let saved = this.cache.peekSnapshot();
    // 启动时仍立即显示检查状态；后续轮询等待轻检查，目录消失无需多等一轮。
    if (!this.isCommitting) {
      saved =
        saved.state === 'checking' || saved.state === 'unchecked'
          ? this.cache.getSnapshot()
          : await this.cache.refreshExpired();
    }
    const { isPathReady: _isPathReady, hasProbed: _hasProbed, ...status } = saved;
    return { ...status, ...this.pdfCount.read(status.folder), canPickFolder: this.canPickFolder() };
  }

  private canPickFolder(): boolean {
    return (this.context.dependencies.platform ?? process.platform) === 'win32';
  }

  /**
   * 仅在 Windows 同时打开一个选择窗口，选择结果只供网页填入。
   * @returns 用户选择、取消、忙或系统失败类别。
   * @throws 无预期错误；注入进程异常转换为固定失败状态。
   */
  async pickFolder(): Promise<CatalogFolderPickResult> {
    if (!this.canPickFolder()) return { kind: 'unsupported' };
    if (this.isPickingFolder) return { kind: 'busy' };
    const { environment, spawn, signal, dependencies } = this.context;
    if (signal.aborted) return { kind: 'failed' };
    // 在任何异步操作前占用窗口，多个标签页也不会同时弹出多个对话框。
    this.isPickingFolder = true;
    try {
      return await (dependencies.pickCatalogFolder ?? pickCatalogFolder)({
        environment,
        spawn,
        signal,
      });
    } catch {
      return { kind: 'failed' };
    } finally {
      this.isPickingFolder = false;
    }
  }

  /**
   * 用户主动刷新时检查写入能力，PDF 计数另行调度。
   * @returns 本轮目录检查完成；已在运行的轻检查结束后才执行探测。
   * @throws 无预期错误。
   */
  async refresh(): Promise<void> {
    await this.saving;
    this.hasInspectionRequest = true;
    while (this.hasInspectionRequest && !this.context.signal.aborted) {
      await this.cache.refresh();
    }
  }

  /**
   * 当前手册目录的下载写入失败时立即退回设置，后续轻检查保留原因。
   * @param reason 已确认的本机写入权限或空间原因。
   * @returns 无返回值；暂停旧目录手册任务。
   * @throws 无预期错误。
   */
  reportWriteFailure(reason: CatalogWriteFailureReason): void {
    const current = this.cache.peekSnapshot();
    if (current.state !== 'ready' || !current.folder || this.context.signal.aborted) return;
    // 正在切换的旧目录状态不能被误报为新配置的写入故障。
    if (this.isCommitting && current.folder !== this.context.config.catalogFolder) return;
    this.cache.setStatus({
      ...current,
      state: 'action-required',
      reason,
      hasProbed: false,
      isPathReady: true,
    });
    void this.applyFolder(undefined).catch(() => {});
  }

  /**
   * 串行校验和保存资料目录，避免两个请求以不同顺序改写配置和索引。
   * @param folder 设置页填写的路径。
   * @returns 持久化与手册目录更新均完成后结束。
   * @throws AppError 路径、读写能力或目录切换失败。
   */
  save(folder: string): Promise<void> {
    const saved = this.saving.then(() => this.saveValidated(folder));
    this.saving = saved.catch(() => {});
    return saved;
  }

  private async saveValidated(folder: string): Promise<void> {
    // 1. 校验及必要时创建末级。2. 应用资料目录并更新手册索引。3. 发布设置状态。
    if (this.context.signal.aborted) throw new AppError('process', 'server_closed', 'catalog');
    const [status, suggestedFolder] = await Promise.all([
      saveCatalogFolder({ ...this.checkOptions(), folder }), // 1.
      this.getSuggestedFolder(),
    ]);
    const destination = this.getReadyFolder(status);
    if (!destination) {
      if (isCatalogFolderReason(status.reason))
        throw new AppError('validation', status.reason, 'catalog');
      throw new AppError('process', 'catalog_check_failed', 'catalog');
    }
    if (this.context.signal.aborted) throw new AppError('process', 'server_closed', 'catalog');
    await this.commit({ destination, status: { ...status, suggestedFolder } }); // 2.、3.
  }

  private writeFolder(folder?: string): void {
    const config = { ...this.context.config, catalogFolder: folder };
    this.context.dependencies.writeConfiguration({ dataDir: this.context.dataDir, config });
    this.context.config = config;
  }

  private async commit(options: { destination: string; status: CatalogStatus }): Promise<void> {
    // 1. 原子保存新设置。2. 切换手册位置再发布。3. 索引失败则恢复旧配置。
    const originalFolder = this.context.config.catalogFolder;
    const originalStatus = this.cache.peekSnapshot();
    this.isCommitting = true;
    this.cache.invalidate();
    let hasWritten = false;
    try {
      this.writeFolder(options.destination); // 1.
      hasWritten = true;
      await this.applyFolder(options.destination); // 2.
      this.cache.setStatus({ ...options.status, isPathReady: true });
      this.pdfCount.schedule({ folder: options.destination, isForced: true });
    } catch (error) {
      if (!hasWritten) throw error;
      this.writeFolder(originalFolder); // 3.
      this.cache.setStatus(originalStatus);
      await this.applyFolder(this.getReadyFolder(originalStatus)).catch(() => {});
      throw new AppError('process', 'catalog_switch_failed', 'catalog');
    } finally {
      this.isCommitting = false;
    }
  }
}
