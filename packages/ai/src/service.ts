// 组合 AI 接口的本机配置、连通状态和流式问答，供本机后台调用。
import { AppError, isAiModel } from '../../core/src/index.ts';
import type {
  AiConfigInput,
  AiChatOutcome,
  AiModelRefreshResult,
  AiModelsInput,
  AiModelsResult,
  AiStatus,
  AiTestResult,
} from '../../core/src/index.ts';
import { AiConfigCredentials } from './config-credentials.ts';
import { parseAiConfig, parseAiModelsInput } from './config-input.ts';
import { classifyInputError, isMatchingSettings } from './config-status.ts';
import { waitForChat } from './chat-deadline.ts';
import type { ChatClockOptions } from './chat-deadline.ts';
import { requestAiChat } from './chat-request.ts';
import type { AiChatStreamOptions } from './chat-request.ts';
import { fetchAiModels, probeAiConnection } from './connection-test.ts';
import type { AiProbeOptions } from './connection-test.ts';
import { createDpapiProtection } from './dpapi.ts';
import type { DpapiOptions, DpapiProtection } from './dpapi.ts';
import { AiModelDiscovery } from './model-discovery.ts';
import type { AiModelList } from './model-list.ts';
import { createAiStorage } from './storage.ts';
import type { AiSettings, AiStorage, AiStorageOptions } from './storage.ts';

/** AI 服务可替换的目录、文件操作、系统加密、HTTP 和毫秒时钟依赖。 */
export type AiServiceOptions = AiStorageOptions &
  Omit<DpapiOptions, 'maxEncodedBytes'> &
  AiProbeOptions &
  ChatClockOptions & { keyProtection?: DpapiProtection };

/**
 * 本机 AI 设置和探测能力；每项只公开安全状态或结果。
 * @property getStatus 读取安全配置摘要；无入参；文件无法访问时抛出安全配置错误。
 * @property fetchModels 使用地址和 Key 请求模型列表，探测失败映射为固定结果。
 * @property refreshModels 用已保存凭据更新名单，失败保留最近一次成功名单。
 * @property switchModel 从已保存名单精确选择，截断时也接受已核实的当前模型。
 * @property saveConfig 保存已经选择或验证的模型，同源时允许沿用 Key；失败时抛出安全错误。
 * @property testConnection 测试表单配置，省略参数时测试已保存配置；网络失败映射为固定结果。
 * @property clearConfig 清除设置及已保存凭据；无入参；文件无法删除时抛出安全配置错误。
 * @property streamAnswer 使用已保存配置流式生成回答，故障和用户停止均返回安全类别。
 */
export type AiService = {
  getStatus: () => Promise<AiStatus>;
  fetchModels: (input: AiModelsInput) => Promise<AiModelsResult>;
  refreshModels: () => Promise<AiModelRefreshResult>;
  switchModel: (model: string) => Promise<AiStatus>;
  saveConfig: (input: AiConfigInput) => Promise<AiStatus>;
  testConnection: (input?: AiConfigInput) => Promise<AiTestResult>;
  clearConfig: () => Promise<AiStatus>;
  streamAnswer: (options: AiChatStreamOptions) => Promise<AiChatOutcome>;
};

type ModelRead = { result: AiModelsResult; list?: AiModelList } & (
  | { effective: AiModelsInput; isUsingSavedKey: boolean }
  | { effective?: undefined }
);

class LocalAiService {
  private readonly options: AiServiceOptions;
  private readonly storage: AiStorage;
  private readonly credentials: AiConfigCredentials;
  private readonly discovery = new AiModelDiscovery();
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: AiServiceOptions) {
    this.options = options;
    this.storage = createAiStorage(options);
    this.credentials = new AiConfigCredentials({
      storage: this.storage,
      protection: options.keyProtection ?? createDpapiProtection(options),
    });
  }

  runInOrder<T>(operation: () => Promise<T>): Promise<T> {
    // 测试和变更按顺序提交，失败后仍允许重试；状态读取不等待网络探测。
    const next = this.pending.then(operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  getStatus(): Promise<AiStatus> {
    return this.credentials.getStatus();
  }

  async fetchModels(input: AiModelsInput): Promise<AiModelsResult> {
    // 1. 清除旧草稿依据并探测本次地址和 Key。2. 只更新完全相同的已保存接口。
    this.discovery.clear(); // 1.
    const saved = this.storage.readSettings();
    const probe = await this.readModels(input, saved);
    if (probe.effective) {
      const { effective, list, isUsingSavedKey } = probe;
      if (
        list &&
        saved &&
        (await this.credentials.matchesSavedEndpoint({ saved, effective, isUsingSavedKey }))
      ) {
        this.storage.writeSettings({ ...saved, modelList: list }); // 2.
      }
      this.discovery.remember(effective, list);
    }
    return probe.result;
  }

  async refreshModels(): Promise<AiModelRefreshResult> {
    // 1. 使用已保存的凭据探测。2. 成功时才原子替换名单，保留当前模型和测试结果。
    const saved = this.storage.readSettings();
    if (!saved) {
      const status = await this.getStatus();
      return { status, result: { kind: 'invalid-address', models: [] } };
    }
    const probe = await this.readModels({ address: saved.address, apiKey: '' }, saved); // 1.
    if (probe.effective && probe.list) {
      this.storage.writeSettings({ ...saved, modelList: probe.list }); // 2.
      this.discovery.updateKnownEndpoint(probe.effective, probe.list);
    }
    return { status: await this.getStatus(), result: probe.result };
  }

  async switchModel(model: string): Promise<AiStatus> {
    const saved = this.storage.readSettings();
    const list = saved?.modelList;
    const isCurrentOutsideList = Boolean(list?.isModelListTruncated && saved?.model === model);
    if (!isAiModel(model) || !saved || (!list?.models.includes(model) && !isCurrentOutsideList))
      throw new AppError('validation', 'ai_model_selection_required', 'ai-config');
    if (saved.model !== model) {
      // 和配置页从成功名单选择模型使用同一有效性依据。
      this.storage.writeSettings({ ...saved, model, lastTest: { kind: 'available' } });
    }
    return this.getStatus();
  }

  private async readModels(input: AiModelsInput, saved: AiSettings | null): Promise<ModelRead> {
    // 1. 规范化地址并取得实际 Key。2. 只请求模型名单并标注成功获取时间。
    let effective: AiModelsInput;
    let isUsingSavedKey: boolean;
    try {
      const config = parseAiModelsInput(input); // 1.
      isUsingSavedKey = config.apiKey === '';
      effective = await this.credentials.resolveKey(config, saved);
    } catch (error) {
      const { kind } = classifyInputError(error);
      return {
        result: {
          kind: kind === 'key-required' || kind === 'invalid-key' ? kind : 'invalid-address',
          models: [],
        },
      };
    }
    const result = await fetchAiModels({ ...this.options, config: effective }); // 2.
    const list: AiModelList | undefined =
      result.kind === 'available'
        ? {
            models: [...result.models],
            modelsFetchedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
            ...(result.isTruncated ? { isModelListTruncated: true } : {}),
          }
        : undefined;
    return { result, list, effective, isUsingSavedKey };
  }

  private async getMatchingSavedSettings(options: {
    saved: AiSettings | null;
    effective: AiModelsInput;
    isUsingSavedKey: boolean;
  }): Promise<AiSettings | null> {
    const { saved, effective, isUsingSavedKey } = options;
    return saved &&
      (await this.credentials.matchesSavedEndpoint({ saved, effective, isUsingSavedKey }))
      ? saved
      : null;
  }

  async writeConfig(input: AiConfigInput): Promise<AiStatus> {
    // 1. 验证输入并取得实际 Key。2. 确认接口校验结果并提交配置。
    const config = parseAiConfig(input); // 1.
    const saved = this.storage.readSettings();
    const effective = await this.credentials.resolveKey(config, saved);
    const isUsingSavedKey = config.apiKey === '';
    const matching = await this.getMatchingSavedSettings({ saved, effective, isUsingSavedKey });
    return this.credentials.saveConfig({
      // 2.
      config,
      saved,
      apiKey: effective.apiKey,
      lastTest: { kind: 'available' },
      modelList: this.discovery.getVerifiedList({
        config: effective,
        savedList: matching?.modelList,
      }),
    });
  }

  async testConfig(input?: AiConfigInput): Promise<AiTestResult> {
    // 1. 根据表单或本地配置解析实际输入。2. 发起探测。3. 只把匹配结果写到当前设置。
    const saved = this.storage.readSettings(); // 1.
    if (!input && !saved) return { kind: 'invalid-address' };
    let config: AiConfigInput;
    let effective: AiConfigInput;
    try {
      config = parseAiConfig(input ?? { address: saved?.address, model: saved?.model });
      effective = await this.credentials.resolveKey(config, saved);
    } catch (error) {
      return classifyInputError(error);
    }
    const matching = await this.getMatchingSavedSettings({
      saved,
      effective,
      isUsingSavedKey: config.apiKey === '',
    });
    const isChatOnly =
      input !== undefined &&
      this.discovery.canTestManualModel({ config: effective, savedList: matching?.modelList });
    const result = await probeAiConnection({ ...this.options, config: effective, isChatOnly }); // 2.
    // 3. 手输保存只接受实际对话成功，其他连通探测结果不能代替它。
    if (isChatOnly) this.discovery.rememberManualTest(effective, result.kind === 'available');
    if (isMatchingSettings(matching, config))
      this.storage.writeSettings({ ...matching, lastTest: result });
    return result;
  }

  async clearConfig(): Promise<AiStatus> {
    // 1. 删除凭据和设置。2. 清除基于旧设置探测的模型。
    const status = this.credentials.clearConfig(); // 1.
    // 2.
    this.discovery.clear();
    return status;
  }

  private async readChatConfig(signal: AbortSignal): Promise<AiConfigInput> {
    signal.throwIfAborted();
    const saved = this.storage.readSettings();
    if (!saved) throw new AppError('validation', 'invalid_ai_key', 'ai-chat');
    const config = parseAiConfig({ address: saved.address, model: saved.model });
    return await this.credentials.resolveKey(config, saved);
  }

  async streamAnswer(options: AiChatStreamOptions): Promise<AiChatOutcome> {
    // 1. 在配置队列内取得同一个版本的地址、模型和 Key。2. 释放队列后执行流式问答。
    const signal = this.options.signal
      ? AbortSignal.any([options.signal, this.options.signal])
      : options.signal;
    try {
      signal.throwIfAborted();
      const config = await waitForChat(
        this.runInOrder(() => this.readChatConfig(signal)),
        signal,
      ); // 1.
      signal.throwIfAborted();
      options.onModel?.(config.model);
      return await requestAiChat({ ...this.options, ...options, config, signal }); // 2.
    } catch (error) {
      if (signal.aborted) return { kind: 'stopped' };
      if (error instanceof AppError && error.subtype === 'invalid_ai_key')
        return { kind: 'invalid-key' };
      return { kind: 'service-error' };
    }
  }
}

/**
 * 创建单个工作台实例使用的 AI 服务。
 * @param options 数据目录和可替换的系统进程、文件操作、网络依赖。
 * @returns 有独立状态且串行变更的 AI 服务。
 * @throws AppError 存储目录不可用；各操作也可能返回安全配置错误。
 */
export function createAiService(options: AiServiceOptions = {}): AiService {
  const service = new LocalAiService(options);
  return {
    getStatus: () => service.getStatus(),
    fetchModels: (input) => service.runInOrder(() => service.fetchModels(input)),
    refreshModels: () => service.runInOrder(() => service.refreshModels()),
    switchModel: (model) => service.runInOrder(() => service.switchModel(model)),
    saveConfig: (input) => service.runInOrder(() => service.writeConfig(input)),
    testConnection: (input) => service.runInOrder(() => service.testConfig(input)),
    clearConfig: () => service.runInOrder(() => service.clearConfig()),
    streamAnswer: (options) => service.streamAnswer(options),
  };
}
