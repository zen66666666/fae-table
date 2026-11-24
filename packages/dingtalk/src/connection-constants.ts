// 集中定义连接检查和登录的固定命令与资源边界，供连接模块使用。
/** 普通连接检查的进程超时，避免网页无限等待。 */
export const STATUS_TIMEOUT_MS = 30_000;
/** 登录授权最多等待五分钟，由用户本人完成扫码。 */
export const LOGIN_TIMEOUT_MS = 5 * 60_000;
/** 只保留足够检查状态的有界输出，不向网页回传原始内容。 */
export const CONNECTION_OUTPUT_BYTES = 1024 * 1024;
/** 独立版本查询仅允许此固定命令，不扩展通用 runner 白名单。 */
export const VERSION_ARGUMENTS = ['--version'] as const;
/** 登录函数只能使用这一命令路径。 */
export const LOGIN_ARGUMENTS = ['auth', 'login'] as const;
/** 查询认证状态时禁止自动刷新登录。 */
export const AUTH_ARGUMENTS = ['auth', 'status', '--readonly', '-f', 'json'] as const;
/** 仅返回已配置身份的只读目录。 */
export const PROFILE_ARGUMENTS = ['profile', 'list', '-f', 'json'] as const;
/** 组织名称缺失时的标签前缀，不使用个人姓名或邮箱。 */
export const PROFILE_LABEL_PREFIX = '组织';
/** 缺失组织名称时只展示组织标识的最后六位，方便辨别且减少暴露。 */
export const PROFILE_LABEL_SUFFIX_LENGTH = 6;
/** 组织名称显示长度上限，避免异常响应占满账号选择控件。 */
export const PROFILE_LABEL_MAX_LENGTH = 160;
