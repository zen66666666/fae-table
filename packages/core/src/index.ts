// 公共模块：向后台、网页和连接模块提供共用类型、配置、对象判断和进程管理。
// isObject 判断对象；asObject 提供对象回退；errorType 投影安全错误；getDataDir 定位数据目录；readConfig/writeConfig 读写配置。
// runProcess 有界执行命令；stopProcess 关闭自有进程；createProcessScope 跟踪子进程；parseCliVersion 提取安全版本号。
/** getNpmGlobalDirectories 按统一优先级生成 npm 全局模块候选目录。 */
export { getNpmGlobalDirectories } from './npm-directories.ts';
export type { NpmGlobalDirectoriesOptions } from './npm-directories.ts';
export { asObject, isObject } from './object.ts';
export type { JsonObject } from './object.ts';
/** getDingtalkConnectionKey 统一生成仅供内存比较的连接失效标识。 */
export { getDingtalkConnectionKey } from './connection-key.ts';
export { AppError, ERROR_TYPES, errorType } from './app-error.ts';
/** getCatalogWriteFailure 将系统写入异常归类为安全的目录权限或空间原因。 */
export { getCatalogWriteFailure } from './app-error.ts';
/** isCatalogFolderReason 核对资料路径的公开错误原因。 */
export {
  CATALOG_FOLDER_PICK_ROUTE,
  isCatalogFolderReason,
  WORKBENCH_STATUS_ROUTES,
} from './connection-types.ts';
export type {
  AppConfig,
  CatalogFolderPickResult,
  CatalogFolderReason,
  CatalogWriteFailureReason,
  ConnectionState,
  ConnectionReason,
  ConnectionStatus,
  DingtalkProfile,
  DingtalkStatus,
  CatalogStatus,
  WorkbenchStatus,
  LoginResult,
} from './connection-types.ts';
export { getDataDir } from './data-directory.ts';
export type { DataDirectoryOptions } from './data-directory.ts';
export { readConfig, writeConfig } from './config.ts';
export type { ConfigOptions } from './config.ts';
export { runProcess } from './run-process.ts';
export { stopProcess, createProcessScope } from './process-scope.ts';
export type { ProcessScope, StopProcessOptions } from './process-scope.ts';
export type { SpawnProcess, ProcessOptions, ProcessResult, ProcessClock } from './process-types.ts';
export { parseCliVersion } from './cli-version.ts';
/** startIndependentProcess 通过 Windows 系统进程服务创建脱离调用方生命周期的后台。 */
export { startIndependentProcess } from './independent-process.ts';
export type { IndependentProcessOptions } from './independent-process.ts';
/** runPowerShell 定位系统 PowerShell 并将编码脚本交给共用有界执行器。 */
export { runPowerShell } from './powershell.ts';
/** PowerShell 固定脚本、环境定位、资源限额和可替换进程依赖。 */
export type { PowerShellOptions } from './powershell.ts';
/** 只读单据的来源、完整性、原因、列表与详情展示契约，由后台和网页共同引用。 */
export type {
  TicketSource,
  TicketReadKind,
  TicketReason,
  TicketSummary,
  TicketProgress,
  TicketSourceResult,
  TicketListResult,
  TicketField,
  TicketRecord,
  TicketTask,
  TicketDetail,
  TicketDetailFailure,
  TicketDetailResult,
  TicketGroup,
  TicketReplyStatus,
  TicketVerification,
  TicketListItem,
  TicketPrefetchProgress,
  TicketListSnapshot,
  TicketDetailSnapshot,
  TicketDraft,
} from './ticket-types.ts';
/** 本机单据路由共用的末段、标识格式和草稿文本上限。 */
export {
  TICKET_DRAFT_MAX_LENGTH,
  TICKET_DRAFT_SEGMENT,
  TICKET_ID_PATTERN,
  TICKET_UPDATE_SEGMENT,
  TICKET_IMAGES_SEGMENT,
  TICKET_TEMPLATES,
} from './ticket-types.ts';
/** isTicketNoteField 识别无需展示或外发的表单说明。 */
export { isTicketNoteField } from './ticket-types.ts';
/** createTicketListFailure / createTicketDetailFailure 统一构造明确失败的只读结果。 */
export { createTicketListFailure, createTicketDetailFailure } from './ticket-results.ts';
/** 计算列表分组和状态、排序快照及判断流程终态。 */
export {
  sortTickets,
  getTicketGroup,
  getTicketReplyStatus,
  isTicketFinished,
  TICKET_GROUP_ORDER,
} from './ticket-order.ts';
/** 快照初始状态及安全失败工厂，供后台与网页共享。 */
export {
  createInitialTicketSnapshot,
  createTicketListSnapshotFailure,
  createTicketDetailSnapshotFailure,
} from './ticket-results.ts';
/** AI 接口的共享 API 路径、测试分类和配置契约。 */
export { AI_MODEL_LIMIT, AI_ROUTES, AI_TEST_KINDS, isAiModel } from './ai-types.ts';
/** 单据对话的本机接口末段及问答限额。 */
export {
  AI_ACTIVE_ROUTE,
  AI_CHAT_ACTIVE_POLL_INTERVAL_MS,
  AI_CHAT_ANSWER_LIMIT,
  AI_CHAT_CLEAR_SEGMENT,
  AI_CHAT_HISTORY_LIMIT,
  AI_CHAT_QUESTION_LIMIT,
  AI_CHAT_SEGMENT,
  AI_CHAT_STOP_SEGMENT,
} from './ai-chat-types.ts';
/** 单据 AI 对话的外发投影、本机历史与流事件。 */
export type {
  AiChatActive,
  AiChatActiveStatus,
  AiChatContext,
  AiChatEvent,
  AiChatHistory,
  AiChatNoAnswer,
  AiChatOutcome,
  AiChatSummary,
  AiChatTurn,
  AiChatStopResult,
  AiChatTrim,
} from './ai-chat-types.ts';
/** AI 接口的表单、公开状态、模型列表和测试结果。 */
export type {
  AiConfigInput,
  AiModelsInput,
  AiModelsResult,
  AiModelRefreshResult,
  AiStatus,
  AiTestResult,
} from './ai-types.ts';
/** 校验基础地址并比较规范化的协议、主机和端口。 */
export { getAiAddress, hasSameAiOrigin } from './ai-address.ts';
/** 用户设置使用的可选读取、删除和原子文件替换。 */
export { readOptionalTextFile, removeOptionalFile, writeAtomicTextFile } from './text-files.ts';
/** 设置存储可替换的文件系统依赖。 */
export type { TextFileSystem } from './text-files.ts';
/** 出站请求共用的响应取消和有界文本读取。 */
export { discardResponse, readBoundedResponseBytes, readBoundedResponseText } from './http-body.ts';
/** 编码表与单据研发人员的固定路径和投影契约。 */
export { CODETABLE_ROUTES, TICKET_PEOPLE_SEGMENT } from './codetable-types.ts';
export type {
  CodeTableReason,
  CodeTableStatus,
  CodeTablePerson,
  CodeTableMatch,
  TicketPeopleResult,
} from './codetable-types.ts';
/** 官网手册页面、响应和单据手册路径的通用契约。 */
export {
  MANUALS_ROUTES,
  TICKET_MANUALS_SEGMENT,
  TICKET_MANUAL_VIEW_SEGMENT,
  TICKET_MANUAL_REDOWNLOAD_SEGMENT,
  TICKET_MANUAL_MODEL_PARAMETER,
} from './manual-types.ts';
export type {
  ManualMatch,
  ManualLookupResult,
  ManualStoredStatus,
  TicketManualsResult,
  TicketManualResult,
} from './manual-types.ts';
/** 从指定已读表单字段提取产品型号，供本机资料查询复用。 */
export { getTicketProductModel, getTicketProductModels } from './ticket-product-model.ts';
/** getRetryDelay 统一计算暂时性失败的有限退避间隔。 */
export { getRetryDelay } from './retry-delay.ts';
/** 单据写回的固定路由、动作限制、文本标准及公开类型。 */
export {
  isTicketWriteAction,
  normalizeTicketWriteText,
  TICKET_WRITE_ACTIONS,
  TICKET_WRITE_ROUTES,
  TICKET_WRITE_TEXT_LIMIT,
} from './ticket-write-types.ts';
export type {
  TicketWriteAction,
  TicketWriteAvailability,
  TicketWriteOutcome,
  TicketWritePreparation,
  TicketWriteSummary,
} from './ticket-write-types.ts';
/** 单据列表、详情及写回确认共用的标题和缺失值。 */
export { getTicketHeading, TICKET_TEXT_PLACEHOLDER } from './ticket-heading.ts';
