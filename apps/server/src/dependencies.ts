// 为后台提供默认文件、进程、时钟和浏览器实现，外部调用可按需替换。
import * as fileSystem from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  AppError,
  createProcessScope,
  getDataDir,
  readConfig,
  runPowerShell,
  runProcess,
  writeConfig,
} from '../../../packages/core/src/index.ts';
import {
  getDingtalkStatus,
  startLogin,
  createTicketReader,
  createTicketWriter,
} from '../../../packages/dingtalk/src/index.ts';
import { createAiService } from '../../../packages/ai/src/index.ts';
import { loadCodeTable } from './codetable-loader.ts';
import { cleanupCodeTableDirectories } from './codetable-directory.ts';
import { CATALOG_FILE_SYSTEM } from './catalog-file-system.ts';
import { getManualsDirectory, openManualsDirectory } from './manuals-directory.ts';
import { BROWSER_COMMANDS, SECRET_BYTES, SERVER_HOST } from './constants.ts';
import type { ServerControlOptions, ServerDependencies } from './types.ts';

const BROWSER_DISPATCH_TIMEOUT_MS = 10_000;
const BROWSER_DISPATCH_OUTPUT_BYTES = 16_384;

/** 默认浏览器分派依赖；可替换平台、环境和有界进程执行器。 */
export type BrowserOpenOptions = {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  run?: typeof runProcess;
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // 无权查询不代表进程已消失，避免覆盖仍被使用的锁。
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * 组合本机默认实现与调用方提供的替代依赖。
 * @param overrides 需要替换的环境依赖。
 * @returns 完整的后台依赖对象。
 * @throws 不抛出预期错误。
 */
export function resolveDependencies(
  overrides: Partial<ServerDependencies> = {},
): ServerDependencies {
  return {
    fileSystem,
    catalogFileSystem: CATALOG_FILE_SYSTEM,
    createHttpServer: createServer,
    createScope: createProcessScope,
    readConfiguration: readConfig,
    writeConfiguration: writeConfig,
    getDingtalkStatus,
    createAiService,
    startLogin,
    createTicketReader,
    createTicketWriter,
    loadCodeTable,
    cleanupCodeTableDirectories,
    getManualsDirectory,
    openManualsDirectory,
    openBrowser: openDefaultBrowser,
    now: Date.now,
    createSecret: () => randomBytes(SECRET_BYTES).toString('hex'),
    isProcessAlive,
    wait,
    schedule: (callback) => {
      setImmediate(callback);
    },
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (timer) => clearTimeout(timer),
    fetch,
    output: console.log,
    pid: process.pid,
    ...overrides,
  };
}

/**
 * 统一解析后台启动和控制入口的目录及环境，避免安装后使用 Skill 目录存放数据。
 * @param options 可替换的数据目录、环境与后台依赖。
 * @returns 绝对数据目录、环境和完整依赖；目录不存在时创建。
 * @throws AppError 或文件系统错误：数据目录缺少配置或无法创建。
 */
export function resolveServerContext(options: ServerControlOptions): {
  dataDir: string;
  environment: NodeJS.ProcessEnv;
  dependencies: ServerDependencies;
} {
  const dependencies = resolveDependencies(options.dependencies);
  const environment = options.environment ?? process.env;
  const dataDir = options.dataDir
    ? path.resolve(options.dataDir)
    : getDataDir({ environment, mkdir: dependencies.fileSystem.mkdirSync });
  dependencies.fileSystem.mkdirSync(dataDir, { recursive: true });
  return { dataDir, environment, dependencies };
}

function createBrowserScript(url: string): string {
  // URL 仅作为 Base64 数据交给固定脚本，不把启动码或输入拼成 PowerShell 表达式。
  const payload = Buffer.from(url, 'utf8').toString('base64');
  return [
    "$ErrorActionPreference = 'Stop'",
    `$url = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))`,
    '$start = New-Object System.Diagnostics.ProcessStartInfo',
    '$start.FileName = $url',
    '$start.UseShellExecute = $true',
    '$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Normal',
    '[Diagnostics.Process]::Start($start) | Out-Null',
  ].join('\n');
}

async function dispatchBrowser(url: string, options: BrowserOpenOptions): Promise<void> {
  const limits = {
    timeoutMs: BROWSER_DISPATCH_TIMEOUT_MS,
    maxOutputBytes: BROWSER_DISPATCH_OUTPUT_BYTES,
    canCaptureOutput: false,
  };
  const platform = options.platform ?? process.platform;
  const file = BROWSER_COMMANDS[platform as keyof typeof BROWSER_COMMANDS];
  if (platform !== 'win32' && !file)
    throw new AppError('configuration', 'browser_open_failed', 'browser');
  const result =
    platform === 'win32'
      ? await runPowerShell({
          ...limits,
          script: createBrowserScript(url),
          environment: options.environment,
          run: options.run,
        })
      : await (options.run ?? runProcess)({ ...limits, file, args: [url] });
  if (result.failure || result.exitCode !== 0)
    throw new AppError('process', 'browser_open_failed', 'browser');
}

/**
 * 通过系统默认 URL 处理器分派本机页面，并等待分派辅助程序完成。
 * @param url 仅允许 http://127.0.0.1 的工作台地址。
 * @param options 可替换平台、环境与进程执行器。
 * @returns 系统已接受打开请求；页面是否到达由后台会话单独确认。
 * @throws AppError：地址无效、平台不支持、分派失败或超时。
 */
export async function openDefaultBrowser(
  url: string,
  options: BrowserOpenOptions = {},
): Promise<void> {
  // 1. 校验本机地址；2. 调用固定分派程序；3. 检查分派结果而非仅检查进程创建。
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== SERVER_HOST ||
      !parsed.port ||
      parsed.username ||
      parsed.password
    ) {
      throw new AppError('validation', 'browser_open_failed', 'browser');
    }
    // 2. 调用者是常驻后台，浏览器不会跟随短时启动器的任务清理而退出。
    await dispatchBrowser(url, options);
    // 3. 只检查短时分派辅助程序的结果，绝不等待或终止用户浏览器。
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('process', 'browser_open_failed', 'browser');
  }
}
