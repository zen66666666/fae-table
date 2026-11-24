// 管理服务自己启动的进程，供后台退出和连接探针资源清理使用。
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ProcessClock, SpawnProcess } from './process-types.ts';

const CLOSE_TIMEOUT_MS = 1000;
const SYSTEM_CLOCK: ProcessClock = { setTimeout, clearTimeout };

/** 关闭等待配置；可替换时限和计时器，默认分阶段各等待一秒。 */
export type StopProcessOptions = {
  timeoutMs?: number;
  clock?: ProcessClock;
  /** 仅适用于可立即终止的读取命令，跳过正常退出等待。 */
  isImmediate?: boolean;
};

async function waitForClose(child: ChildProcess, options: StopProcessOptions): Promise<void> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clock.clearTimeout(timer);
      child.removeListener('close', finish);
      resolve();
    };
    const timer = clock.setTimeout(finish, options.timeoutMs ?? CLOSE_TIMEOUT_MS);
    child.once('close', finish);
  });
}

function closeInput(child: ChildProcess): void {
  try {
    child.stdin?.end();
  } catch {
    // 输入关闭可能与进程退出竞态发生，不影响后续有界终止。
  }
}

async function terminateProcess(child: ChildProcess, options: StopProcessOptions): Promise<void> {
  const closed = waitForClose(child, options);
  if (options.isImmediate) closeInput(child);
  try {
    child.kill();
  } catch {
    // 只处理调用方拥有的进程句柄，不能按名称终止其他程序。
  }
  await closed;
}

/**
 * 正常情况下先关闭输入；明确选择立即终止时直接停止自有读取进程。
 * @param child 调用方拥有的子进程，不能传入用户浏览器或无关进程。
 * @param options 关闭等待时限与可替换计时器。
 * @returns 有界清理完成；进程已退出或无法再终止时也完成。
 * @throws 无预期错误；关闭和终止的系统错误在清理阶段忽略。
 */
export async function stopProcess(
  child: ChildProcess,
  options: StopProcessOptions = {},
): Promise<void> {
  // 1. 选择关闭策略；2. 请求正常退出；3. 必要时终止并有界等待。
  // 1. 已验证的读取命令需要保留原有立即终止语义，不能额外增加正常退出等待。
  if (options.isImmediate) return terminateProcess(child, options);
  if (child.exitCode !== null || child.signalCode !== null) return;
  const firstClose = waitForClose(child, options);
  closeInput(child); // 2. 输入可能已经随进程退出而关闭。
  await firstClose; // 2. 给子进程处理退出的机会。
  if (child.exitCode !== null || child.signalCode !== null) return;
  await terminateProcess(child, options); // 3. 只清理调用方拥有的进程并有界等待。
}

/** 服务进程作用域；所有启动都由 spawn 记录，close 只终止这些子进程。 */
export type ProcessScope = { spawn: SpawnProcess; close: () => Promise<void> };

/**
 * 创建自有进程集合，统一处理后台退出时的资源回收。
 * @param options 可替换的进程启动和关闭函数。
 * @returns 受控 spawn 和幂等 close；关闭后禁止再启动进程。
 * @throws 关闭后调用 spawn 或底层启动失败时抛错。
 */
export function createProcessScope(
  options: {
    spawn?: SpawnProcess;
    stop?: typeof stopProcess;
  } = {},
): ProcessScope {
  const children = new Set<ChildProcess>();
  let isClosed = false;
  let closing: Promise<void> | undefined;
  return {
    spawn(file, args, settings) {
      if (isClosed) throw new Error('Process scope is closed');
      const child = (options.spawn ?? nodeSpawn)(file, args, settings);
      children.add(child);
      child.once('close', () => children.delete(child));
      child.once('error', () => {
        if (!child.pid) children.delete(child);
      });
      return child;
    },
    close() {
      isClosed = true;
      closing ??= Promise.allSettled(
        [...children].map((child) => (options.stop ?? stopProcess)(child)),
      ).then(() => {});
      return closing;
    },
  };
}
