// 通过运行目录锁文件协调单实例启动，复用时必须验证原实例的控制秘密。
import path from 'node:path';
import { AppError, isObject } from '../../../packages/core/src/index.ts';
import { LOCK_FILENAME, STARTUP_RETRY_MS, STARTUP_WAIT_MS } from './constants.ts';
import type { InstanceLock, ServerDependencies, StartedServer } from './types.ts';
import { isInstanceHealthy, reuseHealthyInstance } from './instance-control.ts';

/** 单实例协调结果；已有实例返回句柄，新实例返回锁记录。 */
export type AcquiredInstance = { lock: InstanceLock; reused?: StartedServer };

type InitializingLock = { lock: InstanceLock; waits: number };

function isSameLock(current: InstanceLock | undefined, expected: InstanceLock): boolean {
  return (
    current?.secret === expected.secret &&
    current.pid === expected.pid &&
    current.port === expected.port
  );
}

function trackInitializingLock(
  current: InitializingLock | undefined,
  lock: InstanceLock,
): InitializingLock {
  return { lock, waits: current && isSameLock(current.lock, lock) ? current.waits + 1 : 1 };
}

/**
 * 读取并严格检查锁记录，绝不把不明锁当成可直接覆盖的文件。
 * @param options 数据目录和文件系统依赖。
 * @returns 已存在的有效锁；不存在时返回 undefined。
 * @throws AppError：锁损坏、字段无效或读取失败。
 */
export function readInstanceLock(options: {
  dataDir: string;
  dependencies: ServerDependencies;
}): InstanceLock | undefined {
  let text: string;
  try {
    text = options.dependencies.fileSystem.readFileSync(
      path.join(options.dataDir, LOCK_FILENAME),
      'utf8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new AppError('configuration', 'lock_unreadable', 'server');
  }
  try {
    const value: unknown = JSON.parse(text);
    if (
      isObject(value) &&
      Number.isSafeInteger(value.pid) &&
      Number(value.pid) > 0 &&
      Number.isInteger(value.port) &&
      Number(value.port) >= 0 &&
      Number(value.port) <= 65535 &&
      typeof value.secret === 'string' &&
      /^[a-f0-9]{64}$/.test(value.secret)
    ) {
      return value as InstanceLock;
    }
  } catch {
    // 初始化中的短暂半文件可由外层重试，但绝不能直接删除不明锁。
  }
  throw new AppError('configuration', 'lock_invalid', 'server');
}

/**
 * 只在锁仍属于指定实例时删除，避免关闭动作影响后来启动的服务。
 * @param options 数据目录、原锁和环境依赖。
 * @returns 无返回值。
 * @throws 文件系统无法释放锁时抛错。
 */
export function releaseInstanceLock(options: {
  dataDir: string;
  lock: InstanceLock;
  dependencies: ServerDependencies;
}): void {
  const current = readInstanceLock(options);
  if (isSameLock(current, options.lock)) {
    try {
      options.dependencies.fileSystem.unlinkSync(path.join(options.dataDir, LOCK_FILENAME));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new AppError('configuration', 'lock_release_failed', 'server');
    }
  }
}

/**
 * 将已监听的端口写回本实例锁，不改变其他实例的记录。
 * @param options 数据目录、当前锁、监听端口与依赖。
 * @returns 无返回值。
 * @throws AppError：锁所有权已丢失或写入失败。
 */
export function publishInstancePort(options: {
  dataDir: string;
  lock: InstanceLock;
  port: number;
  dependencies: ServerDependencies;
}): void {
  if (readInstanceLock(options)?.secret !== options.lock.secret) {
    throw new AppError('configuration', 'lock_ownership_lost', 'server');
  }
  options.lock.port = options.port;
  options.dependencies.fileSystem.writeFileSync(
    path.join(options.dataDir, LOCK_FILENAME),
    JSON.stringify(options.lock),
    { mode: 0o600 },
  );
}

function tryCreateLock(options: {
  dataDir: string;
  dependencies: ServerDependencies;
}): InstanceLock | undefined {
  const lock = {
    pid: options.dependencies.pid,
    port: 0,
    secret: options.dependencies.createSecret(),
  };
  try {
    options.dependencies.fileSystem.writeFileSync(
      path.join(options.dataDir, LOCK_FILENAME),
      JSON.stringify(lock),
      { flag: 'wx', mode: 0o600 },
    );
    return lock;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    throw new AppError('configuration', 'lock_unwritable', 'server');
  }
}

/**
 * 独占创建启动锁或复用健康实例；失效锁只删除记录，不终止锁中的 PID。
 * @param options 数据目录与可替换的环境依赖。
 * @returns 新实例的锁或已有实例的可访问句柄。
 * @throws AppError：锁损坏、初始化超时、健康实例复用失败或文件系统不可用。
 */
export async function acquireInstance(options: {
  dataDir: string;
  dependencies: ServerDependencies;
}): Promise<AcquiredInstance> {
  // 1. 尝试独占创建。2. 检查原锁拥有者。3. 复用健康实例或等待初始化。
  const attempts = Math.ceil(STARTUP_WAIT_MS / STARTUP_RETRY_MS);
  let initializing: InitializingLock | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    // 1. wx 保证正常并发启动中只有一个新实例获得锁。
    const created = tryCreateLock(options);
    if (created) return { lock: created };
    let existing: InstanceLock | undefined;
    try {
      existing = readInstanceLock(options);
    } catch {
      initializing = undefined;
      await options.dependencies.wait(STARTUP_RETRY_MS);
      continue;
    }
    if (!existing) continue;
    // 2. PID 已不存在时直接回收记录；仍存活也必须验证健康握手，不能仅凭 PID 复用。
    if (!options.dependencies.isProcessAlive(existing.pid)) {
      initializing = undefined;
      releaseInstanceLock({ ...options, lock: existing });
      continue;
    }
    // 3. 端口为零表示原实例仍在初始化，不能误判为失效。
    if (existing.port > 0) {
      initializing = undefined;
      const control = { lock: existing, dependencies: options.dependencies };
      if (await isInstanceHealthy(control))
        return { lock: existing, reused: await reuseHealthyInstance(control) };
      // 原 PID 可能已被其他程序复用；只释放仍匹配的原锁，绝不 kill 对应进程。
      releaseInstanceLock({ ...options, lock: existing });
      continue;
    }
    initializing = trackInitializingLock(initializing, existing);
    await options.dependencies.wait(STARTUP_RETRY_MS);
  }
  if (initializing?.waits === attempts) {
    // 完整等待窗口后仍是同一条未发布端口的锁，视为初始化残留；只删记录，不终止 PID。
    releaseInstanceLock({ ...options, lock: initializing.lock });
    return await acquireInstance(options);
  }
  throw new AppError('configuration', 'instance_initializing', 'server');
}
