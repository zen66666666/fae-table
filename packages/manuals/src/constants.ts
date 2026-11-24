// 集中定义亿佰特官网的允许路径、型号范围和请求边界，供查询与解析复用。

/** 唯一允许进行资料查询的 HTTPS 来源。 */
export const MANUAL_ORIGIN = 'https://www.ebyte.com';
/** 官网型号搜索的固定路径及唯一查询参数名。 */
export const MANUAL_SEARCH = { path: '/product-all-serch.aspx', query: 'key' } as const;
/** 只接受已知的数字产品路径，不采纳任意候选链接。 */
export const PRODUCT_PATH = /^\/product\/(\d{1,20})\.html$/u;
/** 根据官网的固定产品和资料路径生成已验证数字编号的页面链接。 */
export const MANUAL_PAGE = {
  product: '/product/',
  download: '/downpdf/',
  extension: '.html',
} as const;
/** 输入规范化后的型号长度上限。 */
export const MANUAL_MODEL_MAX_LENGTH = 128;
/** 可读取官网产品名的最长字符数，避免把整段网页传回工作台。 */
export const MANUAL_NAME_MAX_LENGTH = 256;
/** 官网单次请求超时，包含读取正文。 */
export const MANUAL_REQUEST_TIMEOUT_MS = 10_000;
/** 以实际解码后的正文字节数限制 HTML 大小。 */
export const MANUAL_HTML_LIMIT_BYTES = 2 * 1024 * 1024;
/** 已完成查询在内存中可复用的时长。 */
export const MANUAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 暂时不可用时只保留短缓存，官网恢复后不必等待次日。 */
export const MANUAL_FAILURE_TTL_MS = 5 * 60 * 1000;
/** 本实例同时允许进行的官网查询数量。 */
export const MANUAL_REQUEST_CONCURRENCY = 2;
