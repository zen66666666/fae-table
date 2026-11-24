// 检查本机钉钉安装、登录与账号选择，供后台返回脱敏连接状态。
import { AppError, asObject, parseCliVersion, runProcess } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import { classifyDingtalkReason } from './connection-reason.ts';
import { validateCommand } from './command-policy.ts';
import { classifyResult } from './result-classifier.ts';
import { resolveExecutable } from './executable.ts';
import { mustSucceed } from './common.ts';
import { isDingtalkLoginActive } from './login.ts';
import {
  parseConnectionProfiles,
  readProfileAccountName,
  selectConnectionProfile,
} from './connection-profiles.ts';
import type { ConnectionProfile, DingtalkConnectionStatus } from './connection-profiles.ts';
import type { DingtalkStatusOptions } from './connection-types.ts';
import type { Executable } from './runner-types.ts';
import {
  AUTH_ARGUMENTS,
  CONNECTION_OUTPUT_BYTES,
  PROFILE_ARGUMENTS,
  STATUS_TIMEOUT_MS,
  VERSION_ARGUMENTS,
} from './connection-constants.ts';

type StatusContext = { executable: Executable; options: DingtalkStatusOptions };

function createStatus(): DingtalkConnectionStatus {
  return {
    state: 'action-required',
    reason: 'not-installed',
    isInstalled: false,
    version: null,
    isLoggedIn: false,
    profiles: [],
    isProfileSelectionRequired: false,
    selectedProfile: null,
    isLoginInProgress: isDingtalkLoginActive(),
  };
}

async function executeStatusCommand(context: StatusContext, args: readonly string[]) {
  return runProcess({
    file: context.executable.file,
    args: [...context.executable.args, ...args],
    spawn: context.options.spawn,
    signal: context.options.signal,
    clock: context.options.clock,
    stop: context.options.stop,
    cwd: context.options.dataDir,
    timeoutMs: STATUS_TIMEOUT_MS,
    maxOutputBytes: CONNECTION_OUTPUT_BYTES,
  });
}

async function readStatusObject(
  context: StatusContext,
  args: readonly string[],
): Promise<JsonObject> {
  const command = validateCommand(args);
  const result = await executeStatusCommand(context, args);
  if (result.failure)
    throw new AppError(
      result.failure === 'timeout' ? 'timeout' : 'process',
      result.failure,
      command.path,
    );
  return mustSucceed(
    classifyResult(result.stdout, result.stderr, result.exitCode, command.path),
    command.path,
  );
}

function applyFailure(status: DingtalkConnectionStatus, error: unknown): void {
  status.reason = classifyDingtalkReason(error);
  status.state =
    status.reason === 'login-required' || status.reason === 'profile-required'
      ? 'action-required'
      : 'failed';
}

function fillCurrentName(options: {
  context: StatusContext;
  selected: ConnectionProfile;
  auth: JsonObject;
}): void {
  const { context, selected, auth } = options;
  const userId = auth.user_id;
  const identifiers = [selected.corpId, selected.profile, userId];
  selected.accountName ??= readProfileAccountName(auth.user_name, identifiers);
  if (selected.accountName || typeof userId !== 'string' || !context.options.accountNames) return;
  // 只补查刚核实过的当前用户，非阻塞更新本次快照，认证和单据预读不用等待通讯录。
  void context.options.accountNames
    .resolve({
      userIds: [userId],
      profile: selected.profile,
      run: async (args) => ({
        kind: 'success',
        exitCode: 0,
        data: await readStatusObject(context, args),
      }),
    })
    .then((names) => {
      selected.accountName ??= readProfileAccountName(names.get(userId), identifiers);
    })
    .catch(() => {});
}

async function readIdentityStatus(
  context: StatusContext,
  status: DingtalkConnectionStatus,
): Promise<void> {
  const args: string[] = [...AUTH_ARGUMENTS];
  if (context.options.profile) args.push('--profile', context.options.profile);
  // 未登录时目录查询可能失败；独立读取认证状态，不能把正常未登录误报成协议故障。
  const [authResult, catalogResult] = await Promise.allSettled([
    readStatusObject(context, args),
    readStatusObject(context, PROFILE_ARGUMENTS),
  ]);
  if (authResult.status === 'fulfilled')
    status.isLoggedIn = authResult.value.authenticated === true;
  if (catalogResult.status === 'rejected') {
    if (authResult.status === 'fulfilled' && !status.isLoggedIn) {
      status.state = 'action-required';
      status.reason = 'login-required';
      return;
    }
    if (authResult.status === 'rejected' && asObject(authResult.reason).type === 'authentication')
      throw authResult.reason;
    throw catalogResult.reason;
  }
  const profiles = parseConnectionProfiles(catalogResult.value);
  const selected = selectConnectionProfile(profiles, context.options.profile);
  // 后台用已核实组织标识重新登录，不能拆分或猜测 profile；网页响应必须再做明确投影。
  status.profiles = profiles;
  status.selectedProfile = selected?.profile ?? null;
  status.isProfileSelectionRequired = status.profiles.length > 1 && !selected;
  if (context.options.profile && !selected) {
    status.state = 'action-required';
    status.reason = 'profile-invalid';
    return;
  }
  if (authResult.status === 'rejected') throw authResult.reason;
  if (status.isLoggedIn && selected && authResult.value.corp_id !== selected.corpId) {
    throw new AppError('identity', 'profile_mismatch', 'auth status');
  }
  applyIdentityState(status);
  if (status.state === 'ready' && selected)
    fillCurrentName({ context, selected, auth: authResult.value });
}

function applyIdentityState(status: DingtalkConnectionStatus): void {
  if (!status.isLoggedIn || status.profiles.length === 0) {
    status.state = 'action-required';
    status.reason = 'login-required';
  } else if (status.isProfileSelectionRequired) {
    status.state = 'action-required';
    status.reason = 'profile-required';
  } else {
    status.state = 'ready';
    status.reason = 'none';
  }
}

async function readConnectionStatus(
  context: StatusContext,
  status: DingtalkConnectionStatus,
): Promise<void> {
  const version = await executeStatusCommand(context, VERSION_ARGUMENTS);
  if (version.failure || version.exitCode !== 0) {
    throw new AppError(
      version.failure === 'timeout' ? 'timeout' : 'process',
      'version_failed',
      'version',
    );
  }
  status.version = parseCliVersion(version.stdout) ?? parseCliVersion(version.stderr);
  await readIdentityStatus(context, status);
}

/**
 * 1. 定位安装；2. 查询版本、账号目录和只读认证状态；3. 投影安全状态。
 * @param options 可选账号选择、进程工作目录和可替换依赖。
 * @returns 后台内部状态及已核实组织标识；不含凭据，网页使用前必须投影为不透明账号选择值。
 * @throws 无；环境和 CLI 错误转换为连接状态。
 */
export async function getDingtalkStatus(
  options: DingtalkStatusOptions = {},
): Promise<DingtalkConnectionStatus> {
  const status = createStatus();
  let executable: Executable;
  try {
    // 1. 只检查可执行程序路径，不接触 CLI 凭据存储。
    executable = (options.resolve ?? resolveExecutable)(options.environment ?? process.env);
    status.isInstalled = true;
  } catch {
    return status;
  }
  try {
    // 2. 固定读取命令仍经过原有白名单；版本命令是独立的固定调用。
    await readConnectionStatus({ executable, options }, status);
  } catch (error) {
    applyFailure(status, error);
  }
  // 3. 登录进程可能由同时发生的用户点击创建，以实时互斥状态覆盖卡片。
  status.isLoginInProgress = isDingtalkLoginActive();
  if (status.isLoginInProgress) {
    status.state = 'checking';
    status.reason = 'login-in-progress';
  }
  return status;
}
