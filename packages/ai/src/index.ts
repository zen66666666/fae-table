// AI 模块总览：为后台提供 OpenAI 兼容接口的本地配置、连通测试和流式问答。
// Key 和本机问答记录共用当前 Windows 用户 DPAPI，探测和问答分别限制可发送的内容。

/** createAiService 创建工作台实例的 AI 配置、连通服务及流式问答。 */
export { createAiService } from './service.ts';
/** AI 服务及其可替换的系统依赖。 */
export type { AiService, AiServiceOptions } from './service.ts';
/** 流式问答所需的单据材料、会话和输出回调。 */
export type { AiChatStreamOptions } from './chat-request.ts';
/** readAiConfigInput 和 readAiModelsInput 解析受保护 API 的表单形状。 */
export { readAiConfigInput, readAiModelsInput } from './config-input.ts';
/** createDpapiProtection 创建由当前 Windows 用户保护的本机文本加解密。 */
export { createDpapiProtection } from './dpapi.ts';
/** 本机文本加解密能力及其可替换的系统依赖。 */
export type { DpapiOptions, DpapiProtection } from './dpapi.ts';
