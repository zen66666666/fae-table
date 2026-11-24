// 核实和绑定本机资料目录，供手册文件存储与只读文本源使用。
import { assertManualStoreActive, ManualDownloadError } from './download-error.ts';
import { ensureManualDirectory, isSameManualPath } from './store-files.ts';
import type { ManualFileSystem } from './store-files.ts';
import type { ManualStoreIndex } from './store-index.ts';

type DirectoryOptions = {
  getDirectory: () => Promise<string>;
  index: ManualStoreIndex;
  canCreateDirectory?: boolean;
  fileSystem?: Partial<ManualFileSystem>;
  signal?: AbortSignal;
};

/** 单个存储实例的目录定位与索引绑定状态。 */
export class ManualStoreDirectory {
  private readonly options: DirectoryOptions;
  private directorySource?: Promise<string>;
  private boundPath?: string;

  /**
   * 创建待使用时再核实目录的实例。
   * @param options 目录来源、索引和可替换的文件操作。
   * @throws 创建时无预期错误。
   */
  constructor(options: DirectoryOptions) {
    this.options = options;
  }

  /**
   * 取得本次存储已核实的绑定路径。
   * @returns 真实路径；尚未绑定时返回 undefined。
   * @throws 无预期错误。
   */
  getBoundPath(): string | undefined {
    return this.boundPath;
  }

  /**
   * 获取配置中的目录来源。
   * @returns 配置路径，调用者读取文件前须再次核实真实目录。
   * @throws 目录定位失败由配置解析函数抛出。
   */
  resolveSource(): Promise<string> {
    // 已知文件夹成功解析后复用路径；实际目录每次仍须重新核实。
    this.directorySource ??= Promise.resolve()
      .then(() => this.options.getDirectory())
      .catch((error: unknown) => {
        this.directorySource = undefined;
        throw error;
      });
    return this.directorySource;
  }

  /**
   * 读取或重新核实绑定目录。
   * @returns 可用于本次索引访问的真实目录。
   * @throws ManualDownloadError 目录不可用、取消，或已绑定的目录被改指。
   */
  async verify(): Promise<string> {
    // 1. 核实目录存在。2. 仅在此存储范围首次使用时绑定索引，后续不接受链接改指。
    const directory = await ensureManualDirectory({
      // 1.
      fileSystem: this.options.fileSystem,
      getDirectory: () => this.resolveSource(),
      canCreateDirectory: this.options.canCreateDirectory !== false,
      signal: this.options.signal,
    });
    assertManualStoreActive(this.options.signal);
    if (this.boundPath === undefined) {
      // 2.
      this.options.index.bindDirectory(directory);
      this.boundPath = directory;
    } else if (!isSameManualPath(directory, this.boundPath)) {
      throw new ManualDownloadError('storage');
    }
    return directory;
  }
}
