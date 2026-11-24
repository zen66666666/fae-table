// 管理已保存的 AI Key、显示后缀和配置提交，由 AI 接口服务调用。
import { AppError, hasSameAiOrigin } from '../../core/src/index.ts';
import type { AiConfigInput, AiModelsInput, AiStatus, AiTestResult } from '../../core/src/index.ts';
import { getKeyLastFour, isAiKey } from './config-input.ts';
import { assertDistinctPublicFields, getPublicStatus } from './config-status.ts';
import type { DpapiProtection } from './dpapi.ts';
import type { AiModelList } from './model-list.ts';
import type { AiSettings, AiStorage } from './storage.ts';

const EMPTY_STATUS: AiStatus = {
  isConfigured: false,
  address: '',
  model: '',
  keyLastFour: '',
  lastTest: null,
};

/** 已保存设置的凭据管理；只在需要发送请求时向调用方提供完整 Key。 */
export class AiConfigCredentials {
  private readonly storage: AiStorage;
  private readonly protection: DpapiProtection;
  private visibleKey?: { id: string; encrypted: string; suffix: Promise<string | null> };

  /**
   * 绑定同一份配置存储及其加密方式。
   * @param options 本机存储和当前用户加密能力。
   * @throws 创建时无预期错误。
   */
  constructor(options: { storage: AiStorage; protection: DpapiProtection }) {
    this.storage = options.storage;
    this.protection = options.protection;
  }

  private async decryptKey(encrypted: string): Promise<string | null> {
    try {
      const key = await this.protection.unprotect(encrypted);
      return isAiKey(key) ? key : null;
    } catch {
      return null;
    }
  }

  /**
   * 读取当前设置指向的密文。
   * @param settings 已保存的设置。
   * @returns 可用的 Key；没有凭据或解密失败时返回 null。
   * @throws 文件操作失败时由存储层抛出固定错误。
   */
  async readKey(settings: AiSettings | null): Promise<string | null> {
    const encrypted = settings ? this.storage.readCredential(settings.credentialId) : null;
    return encrypted ? await this.decryptKey(encrypted) : null;
  }

  /**
   * 解析用户提供或允许沿用的凭据。
   * @param config 本次地址和用户输入。
   * @param saved 已保存设置，用于核对接口来源。
   * @returns 已补全 Key 的请求配置。
   * @throws AppError 跨来源时缺少新 Key、凭据不可用或公开字段含 Key。
   */
  async resolveKey<T extends AiModelsInput>(config: T, saved: AiSettings | null): Promise<T> {
    // 先校验来源再解密。地址跨协议、主机或端口时必须由用户明确输入新的 Key。
    if (config.apiKey === '' && saved && !hasSameAiOrigin(config.address, saved.address)) {
      throw new AppError('validation', 'ai_key_required', 'ai-config');
    }
    const apiKey = config.apiKey || (await this.readKey(saved));
    if (!apiKey) throw new AppError('validation', 'invalid_ai_key', 'ai-config');
    const effective = { ...config, apiKey };
    assertDistinctPublicFields(effective);
    return effective;
  }

  /**
   * 确认探测或设置草稿是否与已保存的地址和实际 Key 都相同。
   * @param options 已保存设置、已补全凭据的输入和是否由 resolveKey 读取了该旧凭据。
   * @returns 地址和实际 Key 都一致时为 true。
   * @throws 密文文件不可访问时由存储层抛出固定错误。
   */
  async matchesSavedEndpoint(options: {
    saved: AiSettings;
    effective: AiModelsInput;
    isUsingSavedKey: boolean;
  }): Promise<boolean> {
    const { saved, effective, isUsingSavedKey } = options;
    // 同源允许继续使用 Key，但名单只可随完全相同的地址与 Key 复用。
    return (
      saved.address === effective.address &&
      (isUsingSavedKey || effective.apiKey === (await this.readKey(saved)))
    );
  }

  /**
   * 读取现有配置和安全显示后缀。
   * @returns 公开的配置状态，未保存或密文无效时返回未配置状态。
   * @throws 存储不可用时抛出固定错误。
   */
  async getStatus(): Promise<AiStatus> {
    // 1. 读取当前设置和密文。2. 复用已解密的显示后缀，避免状态轮询反复启动 PowerShell。
    const settings = this.storage.readSettings(); // 1.
    if (!settings) return { ...EMPTY_STATUS };
    const id = settings.credentialId;
    const encrypted = this.storage.readCredential(id);
    if (!encrypted) return getPublicStatus(settings, null);
    // 2. 密文改变时才重新解密；无效凭据投影为未配置，可以在向导中更换 Key。
    if (this.visibleKey?.id !== id || this.visibleKey.encrypted !== encrypted) {
      const suffix = this.decryptKey(encrypted).then((key) =>
        key === null ? null : getKeyLastFour(key),
      );
      this.visibleKey = { id, encrypted, suffix };
    }
    return getPublicStatus(settings, await this.visibleKey.suffix);
  }

  private cleanUpCredentials(keepId?: string): void {
    try {
      this.storage.removeOtherCredentials(keepId);
    } catch {
      // 设置已提交。暂时无法清理的旧密文会在下次保存或清除时重试。
    }
  }

  /**
   * 提交已验证接口配置，并只保留其使用的密文。
   * @param options 已验证配置、原配置、实际 Key、连通结果及当次可保存的模型名单。
   * @returns 本次保存的公开配置状态。
   * @throws 加密或原子写入失败时抛出固定错误。
   */
  async saveConfig(options: {
    config: AiConfigInput;
    saved: AiSettings | null;
    apiKey: string;
    lastTest: AiTestResult;
    modelList?: AiModelList;
  }): Promise<AiStatus> {
    // 1. 暂存新密文或沿用原密文。2. 原子提交设置。3. 保留有效密文并更新显示后缀。
    const { config, saved, apiKey, lastTest, modelList } = options;
    let credentialId = config.apiKey === '' ? saved?.credentialId : undefined; // 1.
    let encrypted: string | undefined;
    if (!credentialId) {
      encrypted = await this.protection.protect(apiKey);
      credentialId = this.storage.stageCredential(encrypted);
    }
    const settings: AiSettings = {
      address: config.address,
      model: config.model,
      credentialId,
      lastTest,
      modelList,
    };
    try {
      this.storage.writeSettings(settings); // 2. 设置成功替换后，新 Key 才成为当前 Key。
    } catch (error) {
      this.cleanUpCredentials(saved?.credentialId);
      throw error;
    }
    const suffix = getKeyLastFour(apiKey); // 3.
    if (encrypted !== undefined)
      this.visibleKey = { id: credentialId, encrypted, suffix: Promise.resolve(suffix) };
    this.cleanUpCredentials(credentialId);
    return getPublicStatus(settings, suffix);
  }

  /**
   * 清除本模块的接口设置和已保存凭据。
   * @returns 已清除的公开状态。
   * @throws 文件无法删除时抛出安全配置错误。
   */
  clearConfig(): AiStatus {
    // 1. 删除本模块加密文件。2. 删除元数据并失效内存结果。
    this.storage.removeOtherCredentials(); // 1. 凭据优先删除，中途失败时不能再用已清除的 Key。
    this.storage.clearSettings(); // 2.
    this.visibleKey = undefined;
    return { ...EMPTY_STATUS };
  }
}
