// 编排工作台的后台启动、复用与停止，向双击入口和可选 Skill 提供安全摘要。
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import type { RunningInstance } from '../../../apps/server/src/index.ts';

const ROOT_CANDIDATES = ['../', '../../../'] as const;
const SERVER_ENTRY = 'apps/server/src/index.ts';
const CORE_ENTRY = 'packages/core/src/index.ts';
const DINGTALK_ENTRY = 'packages/dingtalk/src/index.ts';
const LAUNCH_ENTRY = './launch.mjs';
const DINGTALK_COMMAND = 'dws';
const BACKGROUND_ARGUMENT = '--serve';
const STOP_ARGUMENT = '--stop';
const STARTUP_TIMEOUT_MS = 30_000;
const STARTUP_INTERVAL_MS = 100;
const FAILURE_REASONS = new Set([
  'background_creation_failed',
  'background_start_timeout',
  'browser_open_failed',
  'browser_open_timeout',
  'unsupported_platform',
  'missing_system_root',
  'missing_local_app_data',
  'server_stop_timeout',
]);
const ENVIRONMENT_NAMES = [
  'PATH',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'COMSPEC',
  'PROGRAMFILES',
  'PROGRAMW6432',
  'PROCESSOR_ARCHITECTURE',
  'NPM_CONFIG_PREFIX',
  'DWS_BIN',
] as const;

type Modules = {
  server: typeof import('../../../apps/server/src/index.ts');
  core: typeof import('../../../packages/core/src/index.ts');
  dingtalk: typeof import('../../../packages/dingtalk/src/index.ts');
};

/** 启动器的安全结果，用于交互提示和原有的单行 JSON 输出。 */
export type LauncherResult =
  | {
      status: 'started' | 'reused';
      port: number;
      missing: string[];
      reason: 'none';
      launchUrl?: string;
    }
  | { status: 'stopped' | 'not-running' }
  | { status: 'failed'; port: 0; missing: string[]; reason: string };

/** 启动器依赖；默认使用当前 Node、环境、时钟、模块加载和 JSON 输出。 */
export type LauncherOptions = {
  args?: readonly string[];
  isInteractive?: boolean;
  environment?: NodeJS.ProcessEnv;
  scriptUrl?: URL;
  nodeExecutable?: string;
  exists?: typeof existsSync;
  load?: (root: URL) => Promise<Modules>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  formatResult?: (result: LauncherResult) => string;
  output?: (line: string) => void;
};

type LaunchContext = {
  modules: Modules;
  root: URL;
  scriptUrl: URL;
  dataDir: string;
  environment: NodeJS.ProcessEnv;
  options: LauncherOptions;
};

function findRoot(scriptUrl: URL, exists: typeof existsSync): URL {
  for (const candidate of ROOT_CANDIDATES) {
    const root = new URL(candidate, scriptUrl);
    if (exists(fileURLToPath(new URL(SERVER_ENTRY, root)))) return root;
  }
  throw new Error('Incomplete workbench installation');
}

async function loadModules(root: URL): Promise<Modules> {
  const [server, core, dingtalk] = await Promise.all(
    [SERVER_ENTRY, CORE_ENTRY, DINGTALK_ENTRY].map((entry) => import(new URL(entry, root).href)),
  );
  return { server, core, dingtalk } as Modules;
}

function getMissingPrograms(context: LaunchContext): string[] {
  try {
    context.modules.dingtalk.resolveExecutable(context.environment);
    return [];
  } catch {
    return [DINGTALK_COMMAND];
  }
}

function selectBackgroundEnvironment(context: LaunchContext): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  // 只传定位与系统运行所需变量，避免把当前会话中的 token 等凭据复制进系统创建参数。
  for (const [name, value] of Object.entries(context.environment)) {
    if (ENVIRONMENT_NAMES.some((allowed) => allowed === name.toUpperCase()) && value !== undefined)
      environment[name] = value;
  }
  environment.FAE_DATA_DIR = context.dataDir;
  environment.FAE_NO_BROWSER = '1';
  return environment;
}

async function waitForServer(context: LaunchContext): Promise<RunningInstance> {
  const now = context.options.now ?? Date.now;
  const deadline = now() + STARTUP_TIMEOUT_MS;
  while (now() < deadline) {
    try {
      const running = await context.modules.server.getRunningInstance({ dataDir: context.dataDir });
      if (running) return running;
    } catch (error) {
      // 后台刚创建或发布端口时可能瞬间读到半条锁；仅重试这一明确的初始化竞态。
      if (!(error instanceof context.modules.core.AppError) || error.subtype !== 'lock_invalid')
        throw error;
    }
    await (context.options.wait ?? wait)(STARTUP_INTERVAL_MS);
  }
  throw new context.modules.core.AppError('process', 'background_start_timeout', 'launch');
}

async function openPage(context: LaunchContext): Promise<{ port: number; launchUrl?: string }> {
  if (context.environment.FAE_NO_BROWSER === '1') {
    // 自动化模式才申请启动地址，普通模式的发现与健康轮询不产生无用启动码。
    const accessible = await context.modules.server.getRunningServer({ dataDir: context.dataDir });
    if (!accessible)
      throw new context.modules.core.AppError('process', 'server_not_running', 'launch');
    return { port: accessible.port, launchUrl: accessible.launchUrl };
  }
  try {
    const port = await context.modules.server.openRunningServer({ dataDir: context.dataDir });
    return { port };
  } catch (error) {
    if (error instanceof context.modules.core.AppError) throw error;
    throw new context.modules.core.AppError('process', 'browser_open_failed', 'launch');
  }
}

async function openWorkbench(context: LaunchContext): Promise<LauncherResult> {
  // 1. 查找依赖和健康实例；2. 必要时独立启动并等待；3. 打开页面并投影安全摘要。
  // 1. 只检测钉钉程序位置，首次设置在网页完成。
  const missing = getMissingPrograms(context);
  const running = await context.modules.server.getRunningInstance({ dataDir: context.dataDir });
  const isReused = running !== undefined;
  if (!running) {
    // 2. 参数以数组传入系统创建器；后台入口不打开浏览器、不向命令终端输出凭证。
    await context.modules.core.startIndependentProcess({
      file: context.options.nodeExecutable ?? process.execPath,
      args: [fileURLToPath(new URL(LAUNCH_ENTRY, context.scriptUrl)), BACKGROUND_ARGUMENT],
      directory: fileURLToPath(context.root),
      environment: selectBackgroundEnvironment(context),
    });
    await waitForServer(context);
  }
  // 3. 由常驻后台分派浏览器并确认本次页面到达，避免短时命令退出后清理浏览器进程。
  const page = await openPage(context);
  return {
    status: isReused ? 'reused' : 'started',
    ...page,
    missing,
    reason: 'none',
  };
}

async function createContext(options: LauncherOptions): Promise<LaunchContext> {
  const scriptUrl = options.scriptUrl ?? new URL(import.meta.url);
  const root = findRoot(scriptUrl, options.exists ?? existsSync);
  const modules = await (options.load ?? loadModules)(root);
  const environment = options.environment ?? process.env;
  const dataDir = modules.core.getDataDir({ environment });
  return { modules, root, scriptUrl, environment, dataDir, options };
}

function getFailureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'subtype' in error) {
    return typeof error.subtype === 'string' && FAILURE_REASONS.has(error.subtype)
      ? error.subtype.replaceAll('_', '-')
      : 'server-unavailable';
  }
  return 'launcher-unavailable';
}

function writeFailure(options: {
  report: (result: LauncherResult) => void;
  reason: string;
  missing: string[];
}): number {
  options.report({ status: 'failed', port: 0, missing: options.missing, reason: options.reason });
  return 1;
}

/**
 * 1. 校验固定模式；2. 定位运行模块与数据目录；3. 启动、停止或承载后台。
 * @param options 可替换参数、路径、环境、时钟和输出；不接受业务 CLI 命令。
 * @returns 退出码，成功为 0，失败为 1；后台模式完成初始化后继续承载 HTTP 服务。
 * @throws 预期错误均转换为安全状态，不输出原始异常或启动凭证。
 */
export async function runLauncher(options: LauncherOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const output = options.output ?? ((line: string) => process.stdout.write(`${line}\n`));
  const formatResult = options.formatResult ?? JSON.stringify;
  const report = (result: LauncherResult): void => {
    output(formatResult(result));
  };
  const isBackground = args.length === 1 && args[0] === BACKGROUND_ARGUMENT;
  // 1. 参数错误不应触发模块发现、连接检查或后台启动。
  if (
    args.length > 1 ||
    (isBackground && options.isInteractive) ||
    (args.length === 1 && ![STOP_ARGUMENT, BACKGROUND_ARGUMENT].includes(args[0]!))
  )
    return writeFailure({ report, reason: 'invalid-arguments', missing: [] });
  let context: LaunchContext | undefined;
  try {
    // 2. 数据目录沿用 core 默认规则，与安装后的 Skill 文件夹分离。
    context = await createContext(options);
    // 3. 后台常驻并负责打开页面；启动器只负责请求与输出安全摘要。
    if (isBackground) {
      await context.modules.server.startServer({
        dataDir: context.dataDir,
        environment: context.environment,
        // FAE_NO_BROWSER=1 只跳过启动时打开；保留默认浏览器实现供后续 /_fae/open 调用。
        dependencies: { output: () => {} },
      });
    } else if (args[0] === STOP_ARGUMENT) {
      const hasStopped = await context.modules.server.stopServer({ dataDir: context.dataDir });
      report({ status: hasStopped ? 'stopped' : 'not-running' });
    } else report(await openWorkbench(context));
    return 0;
  } catch (error) {
    if (!isBackground) {
      return writeFailure({
        report,
        reason: getFailureReason(error),
        missing: context ? getMissingPrograms(context) : [],
      });
    }
    return 1;
  }
}
