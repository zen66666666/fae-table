// 为连接模块提供不经 shell 的有界进程调用，不负责选择业务命令。
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { stopProcess } from './process-scope.ts';
import type { ProcessClock, ProcessOptions, ProcessResult } from './process-types.ts';

const PROCESS_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const SYSTEM_CLOCK: ProcessClock = { setTimeout, clearTimeout };

class CapturedProcess {
  private child?: ChildProcess;
  private chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  private bytes = 0;
  private isSettled = false;
  private failure: ProcessResult['failure'] = null;
  private timer?: ReturnType<typeof setTimeout>;
  private options: ProcessOptions;
  private resolve: (result: ProcessResult) => void;
  private clock: ProcessClock;

  constructor(options: ProcessOptions, resolve: (result: ProcessResult) => void) {
    this.options = options;
    this.resolve = resolve;
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  start(): void {
    if (this.options.signal?.aborted) {
      this.failure = 'aborted';
      this.finish(null);
      return;
    }
    try {
      // shell 始终关闭，防止业务参数中的特殊字符被操作系统解释为另一条命令。
      this.child = (this.options.spawn ?? nodeSpawn)(this.options.file, [...this.options.args], {
        cwd: this.options.cwd,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      this.failure = 'spawn';
      this.finish(null);
      return;
    }
    this.attachListeners(this.child);
    this.timer = this.clock.setTimeout(
      () => this.stop('timeout'),
      this.options.timeoutMs ?? PROCESS_TIMEOUT_MS,
    );
    this.options.signal?.addEventListener('abort', this.abort, { once: true });
    if (this.options.signal?.aborted) this.abort();
    if (this.options.stdin !== undefined || !this.options.isStdinKeptOpen) {
      this.child.stdin?.end(this.options.stdin);
    }
  }

  private attachListeners(child: ChildProcess): void {
    child.on('error', () => this.handleProcessError());
    child.on('close', (code) => this.finish(code));
    child.stdin?.on('error', () => {
      if (this.options.stdin !== undefined || this.options.isStdinKeptOpen) this.stop('spawn');
    });
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer | string) => this.record(stream, chunk));
    }
  }

  private handleProcessError(): void {
    if (this.options.processErrorPolicy === 'finish') {
      // 旧读取执行器以进程错误优先，覆盖已经观察到的超时并立即返回空退出码。
      this.failure = 'spawn';
      this.finish(null);
      return;
    }
    this.stop('spawn');
  }

  private record(stream: 'stdout' | 'stderr', input: Buffer | string): void {
    if (this.isSettled || this.failure) return;
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const maximum = this.options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    const remaining = Math.max(0, maximum - this.bytes);
    // 授权流程只限制输出量，不保存潜在包含授权信息的文本。
    if (this.options.canCaptureOutput !== false)
      this.chunks[stream].push(chunk.subarray(0, remaining));
    this.bytes += chunk.length;
    if (this.bytes > maximum) this.stop('output-limit');
  }

  private abort = (): void => this.stop('aborted');

  private stop(failure: NonNullable<ProcessResult['failure']>): void {
    if (this.isSettled || this.failure) return;
    this.failure = failure;
    if (this.child) {
      void (this.options.stop ?? stopProcess)(this.child, {
        ...this.options.stopOptions,
        clock: this.clock,
      }).finally(() => this.finish(null));
    } else this.finish(null);
  }

  private finish(exitCode: number | null): void {
    if (this.isSettled) return;
    this.isSettled = true;
    this.clock.clearTimeout(this.timer);
    this.options.signal?.removeEventListener('abort', this.abort);
    this.resolve({
      stdout: Buffer.concat(this.chunks.stdout).toString('utf8'),
      stderr: Buffer.concat(this.chunks.stderr).toString('utf8'),
      exitCode,
      failure: this.failure,
    });
  }
}

/**
 * 执行由上层模块固定选择的命令，并限制运行时长和输出量。
 * @param options 可执行程序、参数、时限、输出上限和可替换进程依赖。
 * @returns 供调用模块内部解析的结果，不应直接输出给用户。
 * @throws 配置的时限或输出上限不是正安全整数时抛错。
 */
export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  for (const limit of [
    options.timeoutMs ?? PROCESS_TIMEOUT_MS,
    options.maxOutputBytes ?? MAX_OUTPUT_BYTES,
  ]) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Invalid process limit');
  }
  return new Promise((resolve) => new CapturedProcess(options, resolve).start());
}
