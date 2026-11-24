// 从统一 npm 候选目录中定位钉钉程序，供只读执行器和独立登录入口使用。
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getNpmGlobalDirectories } from '../../core/src/index.ts';
import type { Executable } from './runner-types.ts';

const PACKAGE_DIRECTORY = 'dingtalk-workspace-cli';
const VENDOR_DIRECTORY = 'vendor';
const NODE_ENTRY = ['bin', 'dws.js'] as const;
const NATIVE_NAME = { win32: 'dws.exe', other: 'dws' };
const SHELL_EXTENSIONS = /\.(cmd|bat|ps1|psm1)$/i;
const NODE_EXTENSIONS = /\.(?:c?js|mjs)$/i;

/** 钉钉程序定位依赖；默认检查本机路径，可替换文件系统、Node 路径和平台。 */
export type ResolveExecutableDependencies = {
  exists?: (file: string) => boolean;
  nodeExecutable?: string;
  platform?: NodeJS.Platform;
  baseDirectory?: string;
};

function resolveExecutableAt(
  file: string,
  dependencies: ResolveExecutableDependencies,
): Executable {
  // 只允许绝对路径，阻止 shell 包装脚本重新解释参数；保持既有校验规则。
  if (!path.isAbsolute(file) || SHELL_EXTENSIONS.test(file)) {
    const error = new Error('DWS command rejected: invalid_executable');
    Object.assign(error, { type: 'policy', subtype: 'invalid_executable' });
    throw error;
  }
  if (!(dependencies.exists ?? existsSync)(file)) throw new Error('DWS executable not found');
  return NODE_EXTENSIONS.test(file)
    ? { file: dependencies.nodeExecutable ?? process.execPath, args: [file] }
    : { file, args: [] };
}

/**
 * 1. 检查显式程序路径；2. 按统一 npm 目录顺序查找原生文件和 Node 入口。
 * @param environment 用于读取安装前缀和 DWS_BIN，保留原有单参数调用方式。
 * @param dependencies 可替换文件存在检查、Node 路径、平台和相对路径基准。
 * @returns 可执行文件及固定前置参数，不包含业务命令或凭据。
 * @throws 路径不安全、安装不存在或注入的文件检查失败时抛错。
 */
export function resolveExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: ResolveExecutableDependencies = {},
): Executable {
  // 1. 显式路径优先，配置错误不能静默切换到其他安装。
  if (environment.DWS_BIN) return resolveExecutableAt(environment.DWS_BIN, dependencies);
  const exists = dependencies.exists ?? existsSync;
  const platform = dependencies.platform ?? process.platform;
  const directories = getNpmGlobalDirectories({
    environment,
    nodeExecutable: dependencies.nodeExecutable,
    baseDirectory: dependencies.baseDirectory,
  });
  // 2. 每个模块目录先查原生程序，再查 Node 入口，保持已验证的安装选择行为。
  for (const modules of directories) {
    const directory = path.join(modules, PACKAGE_DIRECTORY);
    const native = path.join(
      directory,
      VENDOR_DIRECTORY,
      platform === 'win32' ? NATIVE_NAME.win32 : NATIVE_NAME.other,
    );
    if (exists(native)) return resolveExecutableAt(native, dependencies);
    const entry = path.join(directory, ...NODE_ENTRY);
    if (exists(entry)) return resolveExecutableAt(entry, dependencies);
  }
  throw new Error('DWS installation not found; set an absolute DWS_BIN');
}
