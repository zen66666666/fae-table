// 集中定义本机后台的路径、协议标识和资源边界，供服务各部分复用。
import { fileURLToPath } from 'node:url';
import { WORKBENCH_STATUS_ROUTES } from '../../../packages/core/src/index.ts';

/** 本机服务唯一允许监听的回环 IPv4 地址。 */
export const SERVER_HOST = '127.0.0.1';
/** 健康握手返回的固定服务标识，用于排除端口被其他程序占用的情况。 */
export const SERVER_IDENTITY = 'fae-workbench';
/** 数据目录下记录实例 PID、端口和控制秘密的锁文件名。 */
export const LOCK_FILENAME = 'server.lock.json';
/** 本机工作台程序根目录，供资料路径校验和外发过滤共用。 */
export const WORKBENCH_ROOT_DIRECTORY = fileURLToPath(new URL('../../../', import.meta.url));
/** Vite 网页构建产物的绝对目录。 */
export const WEB_DIRECTORY = fileURLToPath(new URL('../../../dist/web/', import.meta.url));
/** 会话 cookie 名称前缀，实际名称追加实例端口以隔离多个工作台。 */
export const COOKIE_NAME_PREFIX = 'fae_session_';
/** 浏览器主动 POST 和草稿读写请求必须携带的标记请求头名称。 */
export const REQUEST_HEADER = 'x-fae-request';
/** 本机实例复用握手携带控制秘密的请求头名称。 */
export const CONTROL_HEADER = 'x-fae-control';
/** 控制秘密、启动码和会话随机值的字节数。 */
export const SECRET_BYTES = 32;
/** 一次性启动码的有效期，单位毫秒。 */
export const LAUNCH_LIFETIME_MS = 120_000;
/** 等待已有实例初始化锁记录的最长时间，单位毫秒。 */
export const STARTUP_WAIT_MS = 5_000;
/** 检查初始化锁记录的重试间隔，单位毫秒。 */
export const STARTUP_RETRY_MS = 50;
/** 本机控制接口请求的超时时间，单位毫秒。 */
export const CONTROL_TIMEOUT_MS = 2_000;
/** 等待本次浏览器会话成功读取连接状态的最长时间，单位毫秒。 */
export const BROWSER_OPEN_TIMEOUT_MS = 30_000;
/** 打开页面控制请求的超时时间，须覆盖页面到达等待，单位毫秒。 */
export const OPEN_CONTROL_TIMEOUT_MS = 35_000;
/** 单项连接状态完成检查后的缓存有效期，单位毫秒。 */
export const STATUS_CACHE_MS = 5_000;
/** 轻检查缓存略短于网页轮询间隔，避免时间边界跳过一轮目录检查。 */
export const CATALOG_LIGHT_CACHE_MS = 4_000;
/** 两次例行 PDF 统计之间的最短间隔，单位毫秒。 */
export const CATALOG_PDF_STATS_MS = 10 * 60_000;
/** 单据后台自动刷新间隔，单位毫秒，从一轮预读结束后计算。 */
export const TICKET_REFRESH_MS = 5 * 60_000;
/** 网页最近一次授权访问允许维持自动刷新的时长，单位毫秒。 */
export const TICKET_ACTIVITY_WINDOW_MS = 10 * 60_000;
/** 每个阶段同时预读的详情数量，单位为张。 */
export const TICKET_PREFETCH_CONCURRENCY = 3;
/** 单据详情标识允许的字符和长度，避免将路径或任意参数传给读取命令。 */
export const TICKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
/** API JSON 请求体的最大字节数。 */
export const BODY_LIMIT_BYTES = 16_384;
/** 关闭后台时允许已有 HTTP 响应完成的时间，单位毫秒。 */
export const SOCKET_CLOSE_MS = 1_000;
/** 资料目录计数使用的 PDF 文件扩展名，不区分大小写。 */
export const PDF_EXTENSION = '.pdf';
/** 需要校验会话和请求来源的业务 API 路径前缀。 */
export const API_PREFIX = '/api';
/** 网页根路径对应的构建入口文件路径。 */
export const INDEX_PATH = '/index.html';
/** 启动交换、连接业务和本机实例控制的固定路由路径。 */
export const ROUTES = {
  launch: '/launch',
  status: WORKBENCH_STATUS_ROUTES.status,
  refreshStatus: WORKBENCH_STATUS_ROUTES.refresh,
  tickets: '/api/tickets',
  refreshTickets: '/api/tickets/refresh',
  login: '/api/dingtalk/login',
  profile: '/api/dingtalk/profile',
  folder: '/api/catalog/folder',
  shutdown: '/api/shutdown',
  health: '/_fae/health',
  reopen: '/_fae/launch',
  open: '/_fae/open',
  stop: '/_fae/shutdown',
} as const;
/** 单据详情与草稿等成员路由的原始路径前缀。 */
export const TICKET_PATH_PREFIX = `${ROUTES.tickets}/`;
/** 允许托管的网页文件扩展名及对应 HTTP 内容类型。 */
export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
/** 非 Windows 平台的默认浏览器命令；Windows 使用有界 ShellExecute 分派。 */
export const BROWSER_COMMANDS = { darwin: 'open', linux: 'xdg-open' };
/** 所有 HTTP 响应使用的缓存、来源、嵌入和内容安全策略。 */
export const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
};
