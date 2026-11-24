// 定义连接检查与登录的可替换依赖，供后台调用钉钉连接接口。
import type { ProcessClock, SpawnProcess, stopProcess } from '../../core/src/index.ts';
import type { Executable } from './runner-types.ts';
import type { MemberNameCache } from './member-name-resolver.ts';

/** 钉钉连接依赖；注入程序定位和进程启动以替换本机环境。 */
export type DingtalkDependencies = {
  spawn?: SpawnProcess;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  resolve?: (environment: NodeJS.ProcessEnv) => Executable;
  clock?: ProcessClock;
  stop?: typeof stopProcess;
};

/** 连接状态检查参数；profile 只用于选择已有身份，dataDir 用作进程工作目录。 */
export type DingtalkStatusOptions = DingtalkDependencies & {
  profile?: string;
  dataDir?: string;
  /** 可选的本机姓名缓存，仅用于显示已经核实的当前登录账号。 */
  accountNames?: MemberNameCache;
};

/** 登录唯一业务参数；profile 为组织标识，不能包含额外命令参数。 */
export type LoginOptions = { profile?: string };

/** 登录可替换依赖；timeoutMs 仅可缩短默认的五分钟限时。 */
export type LoginDependencies = DingtalkDependencies & { timeoutMs?: number };
