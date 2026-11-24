// 集中定义单次手册文本读取、后台负载、缓存和引文输出的限制。

/** 单次 PDF 读取和提取共同使用的硬超时。 */
export const PDF_TEXT_TIMEOUT_MS = 15_000;
/** 解析线程的 V8 老生代上限，防止单个文档持续占用后台内存。 */
export const PDF_WORKER_MEMORY_MB = 192;
/** 一份 PDF 最多尝试读取的页数。 */
export const PDF_PAGE_LIMIT = 300;
/** 一份 PDF 最多缓存的文本字符数。 */
export const PDF_TEXT_CHAR_LIMIT = 750_000;
/** 每份手册缓存中的单页字符上限。 */
export const PDF_PAGE_CHAR_LIMIT = 32_000;
/** 一次只查看限定数量的候选手册。 */
export const MANUAL_SEARCH_FILE_LIMIT = 4;
/** 一个文本索引允许同时读取和解析的文档数。 */
export const MANUAL_TEXT_CONCURRENCY = 2;
/** 同时等待的识别任务上限，预热不能无限积累。 */
export const MANUAL_TEXT_QUEUE_LIMIT = 32;
/** 按 SHA-256 缓存的文档数上限。 */
export const MANUAL_TEXT_CACHE_FILE_LIMIT = 32;
/** 按 SHA-256 缓存的总字符上限，便于限制内存成本。 */
export const MANUAL_TEXT_CACHE_CHAR_LIMIT = 3_000_000;
/** 单次检索的正文总字符上限。 */
export const MANUAL_SNIPPET_TEXT_LIMIT = 5_000;
/** 单次检索最多提供的引文数。 */
export const MANUAL_SNIPPET_LIMIT = 6;
/** 一条引文最多保留的正文字符。 */
export const MANUAL_SNIPPET_CHAR_LIMIT = 840;
