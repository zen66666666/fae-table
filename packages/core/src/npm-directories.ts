// 按统一顺序生成 npm 全局模块目录，供钉钉程序定位使用。
import path from 'node:path';

const NPM_DIRECTORY = 'npm';
const NODE_MODULES_DIRECTORY = 'node_modules';
const LIB_MODULES_DIRECTORY = '../lib/node_modules';

/** npm 目录定位依赖；环境、Node 路径和相对路径基准均可替换。 */
export type NpmGlobalDirectoriesOptions = {
  environment?: NodeJS.ProcessEnv;
  nodeExecutable?: string;
  baseDirectory?: string;
};

/**
 * 1. 按约定收集并去重前缀；2. 依次生成每个前缀的两个模块目录。
 * @param options 可替换的环境、Node 程序路径及相对路径基准。
 * @returns 保持原有查找优先级的 npm 模块目录，不检查文件存在性。
 * @throws 路径参数类型不合法时抛出 Node 路径错误。
 */
export function getNpmGlobalDirectories(options: NpmGlobalDirectoriesOptions = {}): string[] {
  const environment = options.environment ?? process.env;
  // 1. 先去重前缀而非最终目录，保留两个原生定位器已经采用的候选顺序。
  const prefixes = new Set(
    [
      environment.npm_config_prefix,
      environment.APPDATA ? path.join(environment.APPDATA, NPM_DIRECTORY) : undefined,
      path.dirname(options.nodeExecutable ?? process.execPath),
      ...(environment.PATH ?? '').split(path.delimiter),
    ].filter((prefix): prefix is string => Boolean(prefix)),
  );
  // 2. 每个前缀先检查直属 node_modules，再检查 Unix 全局安装的 lib 位置。
  return [...prefixes].flatMap((prefix) => [
    path.join(prefix, NODE_MODULES_DIRECTORY),
    path.resolve(options.baseDirectory ?? process.cwd(), prefix, LIB_MODULES_DIRECTORY),
  ]);
}
