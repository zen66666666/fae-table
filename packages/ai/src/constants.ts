// 集中定义 AI 模块的文件命名、测试路径和资源限制，由存储与探测代码使用。

/** 普通设置的文件名，内容不含 Key 或其后缀。 */
export const AI_SETTINGS_FILE = 'ai-config.json';
/** DPAPI 文件名的固定前缀。 */
export const CREDENTIAL_PREFIX = 'ai-credential-';
/** DPAPI 文件名的固定扩展名。 */
export const CREDENTIAL_SUFFIX = '.dpapi';
/** 凭据标识使用 UUID，配合固定的文件名避免任意路径读取。 */
export const CREDENTIAL_ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu;
/** Key 长度限制，避免页面请求和授权头携带超限数据。 */
export const MAX_KEY_LENGTH = 4096;
/** 整次连通测试的时间上限，两个探测共享同一个截止时间。 */
export const CONNECTION_TIMEOUT_MS = 6000;
/** 服务响应读取上限，应用于解码后的字节数。 */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** 模型列表包含多条元数据，使用独立的解码字节上限。 */
export const MAX_MODELS_RESPONSE_BYTES = 8 * 1024 * 1024;
/** OpenAI 兼容接口的相对路径，保留用户配置的基础路径。 */
export const AI_ENDPOINTS = { models: 'models', chat: 'chat/completions' } as const;
/** 最小对话请求的固定输入，避免把工作台业务数据发送到模型接口。 */
export const TEST_PROMPT = 'Reply OK.';
/** 最小对话请求允许的输出 token 数。 */
export const TEST_MAX_TOKENS = 4;
/** 系统 PowerShell 加密操作的时间上限。 */
export const DPAPI_TIMEOUT_MS = 10_000;
/** 系统 PowerShell 加密操作可捕获的输出上限。 */
export const DPAPI_OUTPUT_BYTES = 16_384;
/** DPAPI 单次调用的安全上限，供加密单张单据的本机问答记录。 */
export const DPAPI_MAX_ENCODED_BYTES = 2 * 1024 * 1024;
/** 能安全展示的 Key 后缀长度。 */
export const KEY_SUFFIX_LENGTH = 4;
/** 流式问答允许的已序列化请求字符数，按 JavaScript 字符长度计。 */
export const CHAT_REQUEST_CHARS = 32_000;
/** 生成模型最多使用的输出 token 数。 */
export const CHAT_MAX_TOKENS = 1200;
/** 最多向浏览器交付的回答字符数。 */
export const CHAT_ANSWER_CHARS = 12_000;
/** 开始请求后收到第一个文本分片的时限。 */
export const CHAT_FIRST_TEXT_TIMEOUT_MS = 60_000;
/** 单次对话自发起请求到结束的总时限。 */
export const CHAT_TOTAL_TIMEOUT_MS = 120_000;
/** 单个 SSE 行或事件允许的文本长度。 */
export const CHAT_EVENT_CHARS = 256 * 1024;
/** 授权凭据出现在资料或回答时使用的固定遮蔽文本。 */
export const CHAT_REDACTED_KEY = '[已隐藏]';
