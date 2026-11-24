// 定义钉钉命令执行层的进程接口和脱敏结果契约。
import type { SpawnProcess } from '../../core/src/index.ts';

/** 可执行文件及其固定前置参数；不包含命令参数或凭据。 */
export type Executable = { file: string; args: string[] };
/** 以文件、参数数组和进程配置启动子进程；返回进程，启动失败时可能抛错。 */
export type SpawnFunction = SpawnProcess;
/** 可返回调用方的错误分类；字段仅包含类型、子类型和操作名。 */
export type SafeError = { type: string; subtype: string; operation: string };
/** 命令执行结果；成功时保留解析后的数据，失败时提供脱敏错误及退出码。 */
export type RunnerResult = {
  kind: 'success' | 'failure' | 'unparseable';
  data?: unknown;
  error?: SafeError;
  exitCode: number | null;
};
/** 接收只读参数数组并异步返回执行结果；预期执行错误通过结果表达。 */
export type Runner = (argv: readonly string[]) => Promise<RunnerResult>;
