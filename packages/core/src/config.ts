// 为本机后台读写有限的用户配置，使用临时文件和改名避免留下半份配置。
import path from 'node:path';
import { AppError } from './app-error.ts';
import { getDataDir } from './data-directory.ts';
import { isObject } from './object.ts';
import type { AppConfig } from './connection-types.ts';
import { readOptionalTextFile, writeAtomicTextFile } from './text-files.ts';
import type { TextFileSystem } from './text-files.ts';

const CONFIG_FILE_NAME = 'config.json';
const CONFIG_KEYS = ['dingtalkProfile', 'catalogFolder'] as const;

/** 配置存储依赖，用于替换目录和文件操作；默认使用本机文件系统。 */
export type ConfigOptions = {
  dataDir?: string;
  fileSystem?: TextFileSystem;
  createId?: () => string;
};

function validateConfig(value: unknown): AppConfig {
  if (
    !isObject(value) ||
    Object.keys(value).some((key) => !CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number]))
  ) {
    throw new AppError('configuration', 'invalid_config', 'config');
  }
  const result: AppConfig = {};
  for (const key of CONFIG_KEYS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].includes('\0')) {
      throw new AppError('configuration', 'invalid_config', 'config');
    }
    result[key] = value[key];
  }
  return result;
}

/**
 * 读取持久配置，首次运行尚无文件时返回空配置。
 * @param options 数据目录与可替换的文件操作。
 * @returns 已验证的账号选择和资料目录。
 * @throws AppError 配置无法读取或内容格式不正确。
 */
export function readConfig(options: ConfigOptions = {}): AppConfig {
  const directory = options.dataDir ?? getDataDir();
  try {
    const text = readOptionalTextFile({
      filename: path.join(directory, CONFIG_FILE_NAME),
      fileSystem: options.fileSystem,
    });
    return text === null ? {} : validateConfig(JSON.parse(text));
  } catch {
    throw new AppError('configuration', 'config_read_failed', 'config');
  }
}

/**
 * 原子替换持久配置。
 * @param options 待保存的完整配置、数据目录及可替换的文件操作和随机标识。
 * @returns 保存成功后无返回值。
 * @throws AppError 配置不合法或写入失败；旧配置在改名成功前保持有效。
 */
export function writeConfig(options: ConfigOptions & { config: AppConfig }): void {
  // 1. 校验白名单字段。2. 通过公共文件工具原子替换配置。
  const config = validateConfig(options.config); // 1. 禁止把额外账号数据或凭据持久化。
  const directory = options.dataDir ?? getDataDir();
  try {
    // 2. 复用原子替换，避免文件写入中断后读到破损配置。
    writeAtomicTextFile({
      filename: path.join(directory, CONFIG_FILE_NAME),
      text: JSON.stringify(config, null, 2),
      fileSystem: options.fileSystem,
      createId: options.createId,
    });
  } catch {
    throw new AppError('configuration', 'config_write_failed', 'config');
  }
}
