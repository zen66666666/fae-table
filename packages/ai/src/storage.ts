// 持久化 AI 设置和已加密的凭据，由配置服务进行串行读写。
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import {
  AI_TEST_KINDS,
  AppError,
  asObject,
  getAiAddress,
  getDataDir,
  isAiModel,
  isObject,
  readOptionalTextFile,
  removeOptionalFile,
  writeAtomicTextFile,
} from '../../core/src/index.ts';
import type { AiTestResult, TextFileSystem } from '../../core/src/index.ts';
import {
  AI_SETTINGS_FILE,
  CREDENTIAL_ID,
  CREDENTIAL_PREFIX,
  CREDENTIAL_SUFFIX,
} from './constants.ts';
import { readStoredAiModelList } from './model-list.ts';
import type { AiModelList } from './model-list.ts';

/** 普通设置、模型名单与最近测试结果；凭据标识仅用于定位 DPAPI 文件。 */
export type AiSettings = {
  address: string;
  model: string;
  credentialId: string;
  lastTest: AiTestResult | null;
  modelList?: AiModelList;
};

/** 可替换的配置文件位置、文件操作及随机 ID 依赖。 */
export type AiStorageOptions = {
  dataDir?: string;
  environment?: NodeJS.ProcessEnv;
  fileSystem?: TextFileSystem;
  readDirectory?: typeof readdirSync;
  createId?: typeof randomUUID;
};

/** 设置存储能力；写入和清除失败时只抛出安全配置错误。 */
export type AiStorage = {
  readSettings: () => AiSettings | null;
  writeSettings: (settings: AiSettings) => void;
  readCredential: (id: string) => string | null;
  stageCredential: (encrypted: string) => string;
  removeOtherCredentials: (keepId?: string) => void;
  clearSettings: () => void;
};

function getCredentialName(id: string): string {
  if (!CREDENTIAL_ID.test(id))
    throw new AppError('configuration', 'ai_storage_unavailable', 'ai-storage');
  return `${CREDENTIAL_PREFIX}${id}${CREDENTIAL_SUFFIX}`;
}

function isCredentialName(filename: string): boolean {
  return (
    filename.startsWith(CREDENTIAL_PREFIX) &&
    filename.endsWith(CREDENTIAL_SUFFIX) &&
    CREDENTIAL_ID.test(filename.slice(CREDENTIAL_PREFIX.length, -CREDENTIAL_SUFFIX.length))
  );
}

function parseSettings(text: string | null): AiSettings | null {
  if (text === null) return null;
  try {
    const value = asObject(JSON.parse(text));
    const { address, model, credentialId } = value;
    if (
      typeof address !== 'string' ||
      !getAiAddress(address) ||
      typeof model !== 'string' ||
      !isAiModel(model) ||
      typeof credentialId !== 'string' ||
      !CREDENTIAL_ID.test(credentialId)
    )
      return null;
    const lastTest = AI_TEST_KINDS.find((kind) => kind === asObject(value.lastTest).kind);
    return {
      address,
      model,
      credentialId,
      lastTest: lastTest ? { kind: lastTest } : null,
      modelList: readStoredAiModelList(value),
    };
  } catch {
    // 配置损坏时允许重新设置，避免每次启动都阻塞工作台页面。
    return null;
  }
}

function getStorageResult<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new AppError('configuration', 'ai_storage_unavailable', 'ai-storage');
  }
}

function getCredentialNames(options: AiStorageOptions & { directory: string }): string[] {
  try {
    return (options.readDirectory ?? readdirSync)(options.directory);
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * 创建用户本机的普通设置和 DPAPI 文件存储。
 * @param options 数据目录和可替换的文件操作。
 * @returns 独立读写设置及加密凭据的操作。
 * @throws AppError 默认本机数据目录不可用时抛出配置错误。
 */
export function createAiStorage(options: AiStorageOptions): AiStorage {
  // 1. 确定数据目录。2. 组合文件操作并按固定名称绑定设置和加密凭据。
  const directory =
    options.dataDir ??
    getDataDir({ environment: options.environment, mkdir: options.fileSystem?.mkdirSync }); // 1.
  const settingsPath = path.join(directory, AI_SETTINGS_FILE);
  const createId = options.createId ?? randomUUID;
  // 2. 公共文件工具原子替换文件，持久化步骤仅使用已经加密的凭据。
  const write = (filename: string, text: string): void =>
    getStorageResult(() =>
      writeAtomicTextFile({ filename, text, createId, fileSystem: options.fileSystem }),
    );
  const read = (filename: string): string | null =>
    getStorageResult(() => readOptionalTextFile({ filename, fileSystem: options.fileSystem }));
  const remove = (filename: string): void =>
    getStorageResult(() => removeOptionalFile({ filename, fileSystem: options.fileSystem }));
  return {
    readSettings: () => parseSettings(read(settingsPath)),
    writeSettings: ({ modelList, ...settings }) =>
      write(settingsPath, JSON.stringify({ ...settings, ...modelList }, null, 2)),
    clearSettings: () => remove(settingsPath),
    readCredential: (id) => read(path.join(directory, getCredentialName(id))),
    stageCredential: (encrypted) => {
      const id = createId();
      write(path.join(directory, getCredentialName(id)), encrypted);
      return id;
    },
    removeOtherCredentials: (keepId) =>
      getStorageResult(() => {
        const keepName = keepId ? getCredentialName(keepId) : null;
        for (const name of getCredentialNames({ ...options, directory })) {
          if (name !== keepName && isCredentialName(name)) remove(path.join(directory, name));
        }
      }),
  };
}
