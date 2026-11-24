// 绑定模型获取或手动测试结果与配置草稿，供 AI 配置服务校验保存。
import { createHmac, randomBytes } from 'node:crypto';
import { AppError } from '../../core/src/index.ts';
import type { AiConfigInput, AiModelsInput } from '../../core/src/index.ts';
import type { AiModelList } from './model-list.ts';

const FINGERPRINT_SECRET_BYTES = 32;
type Discovery = { fingerprint: string; list?: AiModelList };

/** 当前配置草稿的校验依据；保留带随机密钥的摘要与筛选后的模型名称。 */
export class AiModelDiscovery {
  private readonly secret = randomBytes(FINGERPRINT_SECRET_BYTES);
  private discovery?: Discovery;
  private testedManualFingerprint?: string;

  /**
   * 清除之前获取和手动测试的保存依据。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  clear(): void {
    this.discovery = undefined;
    this.testedManualFingerprint = undefined;
  }

  /**
   * 记录一组完整凭据对应的模型获取结果。
   * @param config 规范化后的地址和实际发送的 Key。
   * @param list 获取成功的名单，缺少名单表示可尝试手动验证。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  remember(config: AiModelsInput, list?: AiModelList): void {
    this.discovery = { fingerprint: this.getFingerprint(config), list };
    this.testedManualFingerprint = undefined;
  }

  /**
   * 同步已保存接口刷新得到的新名单，避免相同草稿随后覆盖较新的名单。
   * @param config 已保存接口的实际地址和 Key。
   * @param list 最新获取并已写盘的名单。
   * @returns 无返回值；正在编辑其他接口的草稿保持原状态。
   * @throws 无预期错误。
   */
  updateKnownEndpoint(config: AiModelsInput, list: AiModelList): void {
    if (this.getMatchingDiscovery(config)) this.remember(config, list);
  }

  /**
   * 判断同一接口是否开放手动验证，手动测试必须直接调用对话。
   * @param options 已验证的地址和实际 Key，以及同接口保存的名单。
   * @returns 名单获取失败或已被截断时为 true。
   * @throws 无预期错误。
   */
  canTestManualModel(options: { config: AiModelsInput; savedList?: AiModelList }): boolean {
    const { config, savedList } = options;
    const discovery = this.getMatchingDiscovery(config);
    return discovery
      ? !discovery.list || discovery.list.isModelListTruncated === true
      : savedList?.isModelListTruncated === true;
  }

  /**
   * 记录真实对话验证的结果，只批准这一个地址、Key 和模型名称的组合。
   * @param config 本次实际发送验证的配置。
   * @param isAvailable 是否已从对话收到有效回复。
   * @returns 无返回值；失败会丢弃之前的手输测试依据。
   * @throws 无预期错误。
   */
  rememberManualTest(config: AiConfigInput, isAvailable: boolean): void {
    this.testedManualFingerprint = isAvailable
      ? this.getFingerprint(config, config.model)
      : undefined;
  }

  /**
   * 验证保存的模型已经获取或通过手动对话测试，并选择同一接口的名单。
   * @param options 待保存的实际配置和同地址同 Key 才能复用的已保存名单。
   * @returns 需要原子保存的名单；已验证的手动模型可以没有名单。
   * @throws AppError 模型未从名单选择或手动对话测试尚未通过。
   */
  getVerifiedList(options: {
    config: AiConfigInput;
    savedList?: AiModelList;
  }): AiModelList | undefined {
    const { config, savedList } = options;
    const discovery = this.getMatchingDiscovery(config);
    if (discovery && !discovery.list) {
      this.assertManualTest(config);
      return savedList;
    }
    const list = discovery?.list ?? savedList;
    if (list?.models.includes(config.model)) return list;
    if (list?.isModelListTruncated) {
      this.assertManualTest(config);
      return list;
    }
    throw new AppError('validation', 'ai_model_selection_required', 'ai-config');
  }

  private assertManualTest(config: AiConfigInput): void {
    if (this.testedManualFingerprint !== this.getFingerprint(config, config.model))
      throw new AppError('validation', 'ai_model_test_required', 'ai-config');
  }

  private getMatchingDiscovery(config: AiModelsInput): Discovery | undefined {
    return this.discovery?.fingerprint === this.getFingerprint(config) ? this.discovery : undefined;
  }

  private getFingerprint(config: AiModelsInput, model?: string): string {
    // 进程内的随机密钥避免把草稿 Key 明文保留在模型校验证据里。
    const fields = JSON.stringify([config.address, config.apiKey, model ?? null]);
    return createHmac('sha256', this.secret).update(fields).digest('base64');
  }
}
