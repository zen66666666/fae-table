// 为后台提供连接、登录、单据读取与经过核验的审批写入，为开发命令提供只读和事件探针。
// getDingtalkStatus 检查安装和身份；validateLoginOptions 校验授权输入；startLogin 启动有界授权；isDingtalkLoginActive 报告授权进行状态。
// listTickets 合并列表；getTicketDetail 并行读取详情；createTicketReader 复用身份和姓名；canReadTickets 检查读取前置条件。

/** CODETABLE_FILE_NAME 提供临时目录中的固定编号表文件名。 */
export { CODETABLE_FILE_NAME } from './command-policy.ts';
/** downloadCodeTable 使用当前已选账号查询并下载唯一匹配的编号表。 */
export { downloadCodeTable } from './codetable-download.ts';
/** 编号表下载使用的临时目录、账号及运行依赖。 */
export type { CodeTableDownloadOptions } from './codetable-download.ts';
/** createRunner 创建受白名单约束的只读进程执行器。 */
export { createRunner } from './runner.ts';
/** validateCommand 校验完整命令和参数。 */
export { validateCommand } from './command-policy.ts';
/** classifyResult 判定已确认 CLI 契约的返回结果。 */
export { classifyResult } from './result-classifier.ts';
/** resolveExecutable 定位钉钉程序而不读取凭据文件。 */
export { resolveExecutable } from './executable.ts';
/** 钉钉程序定位时可替换的文件系统、平台和 Node 路径依赖。 */
export type { ResolveExecutableDependencies } from './executable.ts';
/** runtimeDirectory 限制原始输出位置；newRunDir 为探针创建独立目录。 */
export { runtimeDirectory, REPO_ROOT, newRunDir } from './runtime-directory.ts';
export type { SpawnFunction, RunnerResult } from './runner-types.ts';
export type { Run } from './common.ts';
/** identify 通过只读状态交叉核对身份。 */
export { identify } from './identity.ts';
/** parseArguments 解析探针的有界运行参数。 */
export { parseArguments } from './probe-arguments.ts';
/** probeReadonly 读取脱敏审批样本；parsePage 校验分页；assertSummaryKeys 校验摘要；errorType 投影安全错误类别。 */
export { probeReadonly, parsePage, assertSummaryKeys, errorType } from './readonly.ts';
/** EventParser 解析事件行；consumeEvents 运行有界订阅；probeEvents 编排订阅及清理核验。 */
/** discoverOaEvents 校验目录；parseSubscriptionSnapshot 解析订阅；emptyEventSummary 创建初始摘要。 */
export {
  EventParser,
  consumeEvents,
  probeEvents,
  discoverOaEvents,
  parseSubscriptionSnapshot,
  emptyEventSummary,
  EVENT_SUMMARY_KEYS,
  OA_EVENT_KEYS,
} from './events.ts';
export { getDingtalkStatus } from './connection-status.ts';
/** 后台内部连接状态及核实账号，含组织标识；必须经后台安全投影后才能发送网页。 */
export type { DingtalkConnectionStatus, ConnectionProfile } from './connection-profiles.ts';
export { startLogin, isDingtalkLoginActive, validateLoginOptions } from './login.ts';
export type {
  DingtalkDependencies,
  DingtalkStatusOptions,
  LoginOptions,
  LoginDependencies,
} from './connection-types.ts';
/** listTickets 分页读取待办、抄送和已处理；getTicketDetail 并行合并详情、记录和任务。 */
export { listTickets } from './ticket-list.ts';
export { getTicketDetail } from './ticket-detail.ts';
/** 从详情的私有证据查询已核实的任务，不加入网页展示字段。 */
export { getTicketOwnedRunningTask, hasTicketOwnedRunningTask } from './ticket-write-evidence.ts';
/** 单据读取的连接前置条件、执行器与环境依赖，以及详情对应的列表摘要。 */
export type { TicketReadOptions, TicketDetailOptions } from './ticket-options.ts';
/** canReadTickets 统一判断连接是否就绪，供后台和单据读取复用。 */
export { canReadTickets } from './ticket-options.ts';
/** createTicketReader 为单个后台创建私有身份缓存和连续只读入口。 */
export { createTicketReader } from './ticket-reader.ts';
/** 连续读取器及其可替换时钟配置，不暴露身份缓存内容。 */
export type { TicketReader, TicketReaderOptions } from './ticket-reader.ts';
/** createMemberNameResolver 合并受控通讯录读取，只在内存缓存成员 ID 到姓名。 */
export { createMemberNameResolver } from './member-name-resolver.ts';
/** 姓名查询、解析替换函数、批次调度配置及只读缓存入口。 */
export type {
  MemberNameResolver,
  MemberNameQuery,
  MemberNameResolverOptions,
  MemberNameCache,
} from './member-name-resolver.ts';

/** createTicketWriter 使用预读任务和已核实账号，仅执行两步确认后允许的审批命令。 */
export { createTicketWriter } from './ticket-writer.ts';
/** 单据预读证据、有限写入及安全的结果复核契约。 */
export type {
  DingtalkWriteExecution,
  DingtalkWriteResult,
  DingtalkWriteState,
  DingtalkWriteStateInput,
  DingtalkWriteVerify,
  TicketWriter,
  TicketWriterOptions,
} from './ticket-writer.ts';
/** 写入结果不明时只读核实的固定类别。 */
export type { DingtalkWriteVerification } from './approval-write-evidence.ts';
/** getTicketRecordImageUrl 只从当前详情的私有映射取得记录图片地址。 */
export { getTicketRecordImageUrl } from './ticket-records.ts';
/** readTicketImage 通过后台注入的 fetch 匿名读取有界的钉钉图片。 */
export { readTicketImage } from './ticket-image-response.ts';
