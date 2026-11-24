// 声明后台可替换的环境依赖与启动契约，供模块入口和内部服务组合使用。
import type * as fileSystem from 'node:fs';
import type { createServer } from 'node:http';
import type {
  AppConfig,
  SpawnProcess,
  createProcessScope,
  readConfig,
  writeConfig,
} from '../../../packages/core/src/index.ts';
import type {
  getDingtalkStatus,
  startLogin,
  createTicketReader,
  createTicketWriter,
} from '../../../packages/dingtalk/src/index.ts';
import type { createAiService, createDpapiProtection } from '../../../packages/ai/src/index.ts';
import type { ManualStoreOptions } from '../../../packages/manuals/src/index.ts';
import type { loadCodeTable } from './codetable-loader.ts';
import type { cleanupCodeTableDirectories } from './codetable-directory.ts';
import type { getManualsDirectory, openManualsDirectory } from './manuals-directory.ts';
import type { CatalogFileSystem } from './catalog-file-system.ts';
import type { pickCatalogFolder } from './catalog-folder-picker.ts';
import type { TicketAiHistoryFileSystem } from './ticket-ai-history-files.ts';

/** 后台需要的文件操作；可替换成隔离的文件系统实现。 */
export type ServerFileSystem = Pick<
  typeof fileSystem,
  | 'readFileSync'
  | 'writeFileSync'
  | 'unlinkSync'
  | 'mkdirSync'
  | 'statSync'
  | 'readdirSync'
  | 'accessSync'
  | 'realpathSync'
>;

/** 后台环境依赖；默认实现由 dependencies.ts 提供。 */
export type ServerDependencies = {
  fileSystem: ServerFileSystem;
  catalogFileSystem: CatalogFileSystem;
  /** Windows 文件夹选择进程及平台检查，可替换用于离线自检。 */
  pickCatalogFolder?: typeof pickCatalogFolder;
  platform?: NodeJS.Platform;
  /** 可选的手册文件操作覆盖，默认由手册模块使用本机实现。 */
  manualFileSystem?: ManualStoreOptions['fileSystem'];
  createHttpServer: typeof createServer;
  createScope: typeof createProcessScope;
  readConfiguration: typeof readConfig;
  writeConfiguration: typeof writeConfig;
  getDingtalkStatus: typeof getDingtalkStatus;
  createAiService: typeof createAiService;
  /** 可替换的 AI 历史加密与文件操作，默认使用 Windows 当前用户和运行目录。 */
  createChatHistoryProtection?: typeof createDpapiProtection;
  chatHistoryFileSystem?: TicketAiHistoryFileSystem;
  startLogin: typeof startLogin;
  createTicketReader: typeof createTicketReader;
  createTicketWriter: typeof createTicketWriter;
  loadCodeTable: typeof loadCodeTable;
  cleanupCodeTableDirectories: typeof cleanupCodeTableDirectories;
  getManualsDirectory: typeof getManualsDirectory;
  openManualsDirectory: typeof openManualsDirectory;
  now: () => number;
  createSecret: () => string;
  isProcessAlive: (pid: number) => boolean;
  wait: (milliseconds: number) => Promise<void>;
  schedule: (callback: () => void) => void;
  setTimer: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  fetch: typeof fetch;
  /** 图片内存缓存的可替换字节上限；未提供时使用 200 MiB。 */
  ticketImageCacheMaxBytes?: number;
  openBrowser: (url: string) => Promise<void>;
  output: (line: string) => void;
  pid: number;
};

/**
 * 启动参数；环境与文件/进程/时钟依赖可替换，默认使用本机实现。
 * dataDir 指定运行目录；浏览器打开函数仅通过 dependencies.openBrowser 注入。
 * manualsDirectory 为开发或自检指定手册文件的绝对目录。
 */
export type StartServerOptions = {
  dataDir?: string;
  manualsDirectory?: string;
  environment?: NodeJS.ProcessEnv;
  dependencies?: Partial<ServerDependencies>;
};

/** 已有实例控制选项；仅定位和控制本机服务，不启动服务或读取业务配置。 */
export type ServerControlOptions = Pick<
  StartServerOptions,
  'dataDir' | 'environment' | 'dependencies'
>;

/** 已启动或复用的本机服务；close 停止该服务及其拥有的子进程。 */
export type StartedServer = {
  port: number;
  launchUrl: string;
  close: () => Promise<void>;
};

/** 已通过密钥健康检查的运行实例；不包含启动码、会话或锁文件秘密。 */
export type RunningInstance = { port: number };

/** 锁文件记录；控制秘密仅用于同一用户的本机实例复用，不发给网页。 */
export type InstanceLock = { pid: number; port: number; secret: string };

/** 连接服务运行上下文；配置只由后台持有，网页通过类型化接口修改。 */
export type ConnectionContext = {
  dataDir: string;
  manualsDirectory?: string;
  environment: NodeJS.ProcessEnv;
  spawn: SpawnProcess;
  signal: AbortSignal;
  dependencies: ServerDependencies;
  config: AppConfig;
};
