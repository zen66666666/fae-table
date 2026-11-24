// 以白名单参数运行有界事件订阅，限制输出并优雅关闭自有子进程。
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { validateCommand } from './command-policy.ts';
import { resolveExecutable } from './executable.ts';
import { runtimeDirectory } from './runtime-directory.ts';
import { EventParser } from './event-parser.ts';
import type { Clock, ConsumeOptions, ConsumeResult } from './event-types.ts';
import type { Executable } from './runner-types.ts';

const SYSTEM_CLOCK: Clock = { setTimeout, clearTimeout };
type Settings = {
  argv: string[];
  durationMs: number;
  executable: Executable;
  clock: Clock;
  readyTimeoutMs: number;
  maxOutputBytes: number;
  logDir: string;
};

function validateExecutable(executable: Executable): void {
  // 禁止 shell 包装器及空字节，避免参数绕过数组执行边界。
  if (
    !executable ||
    typeof executable.file !== 'string' ||
    !path.isAbsolute(executable.file) ||
    /\.(?:cmd|bat|ps1|psm1)$/i.test(executable.file) ||
    executable.file.includes('\0') ||
    !Array.isArray(executable.args) ||
    executable.args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
  ) {
    throw new Error('Invalid event executable');
  }
}

function prepareSettings(options: ConsumeOptions): Settings {
  const argv = [
    'event',
    'consume',
    ...options.eventKeys,
    '--flatten',
    '-f',
    'ndjson',
    '--duration',
    `${options.seconds}s`,
  ];
  if (options.profile) argv.push('--profile', options.profile);
  const durationMs = validateCommand(argv).durationMs;
  if (!durationMs || !Number.isFinite(durationMs))
    throw new Error('Invalid bounded event duration');
  const executable = options.executable ?? resolveExecutable();
  validateExecutable(executable);
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024;
  if (
    !Number.isSafeInteger(readyTimeoutMs) ||
    readyTimeoutMs <= 0 ||
    readyTimeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0
  )
    throw new Error('Invalid event resource limits');
  return {
    argv,
    durationMs,
    executable,
    clock: options.clock ?? SYSTEM_CLOCK,
    readyTimeoutMs,
    maxOutputBytes,
    logDir: runtimeDirectory(options.logDir),
  };
}

class EventSession {
  private isSettled = false;
  private hasClosedStdin = false;
  private hasReadyTimedOut = false;
  private hasForcedTermination = false;
  private hasOutputLimitExceeded = false;
  private hasFailed = false;
  private bytes = 0;
  private readyTimer: any;
  private durationTimer: any;
  private hardTimer: any;
  private killWaitTimer: any;
  private child: ChildProcess;
  private parser: EventParser;
  private options: ConsumeOptions;
  private settings: Settings;
  private resolve: (result: ConsumeResult) => void;

  constructor(
    options: ConsumeOptions,
    settings: Settings,
    resolve: (result: ConsumeResult) => void,
  ) {
    this.options = options;
    this.settings = settings;
    this.resolve = resolve;
    const spawn = options.spawn ?? nodeSpawn;
    this.child = spawn(settings.executable.file, [...settings.executable.args, ...settings.argv], {
      shell: false,
      windowsHide: true,
      cwd: settings.logDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.parser = new EventParser(options.eventKeys, () => this.startObservation());
  }

  start(): void {
    this.child.stdout?.on('data', (chunk) => this.record('stdout', chunk));
    this.child.stderr?.on('data', (chunk) => this.record('stderr', chunk));
    this.child.stdin?.on('error', () => {
      this.hasFailed = true;
    });
    this.child.on('error', () => {
      this.hasFailed = true;
      this.finish(null);
    });
    this.child.on('close', (code, signal) => this.finish(code, signal));
    this.readyTimer = this.settings.clock.setTimeout(() => {
      this.hasReadyTimedOut = true;
      this.stopGracefully();
    }, this.settings.readyTimeoutMs);
    this.armHardDeadline();
    this.options.signal?.addEventListener('abort', this.abort, { once: true });
    if (this.options.signal?.aborted) this.abort();
  }

  private stopGracefully(): void {
    if (this.hasClosedStdin) return;
    this.hasClosedStdin = true;
    try {
      this.child.stdin?.end();
    } catch {
      this.hasFailed = true;
    }
  }

  private armHardDeadline(): void {
    const clock = this.settings.clock;
    if (this.hardTimer !== undefined) clock.clearTimeout(this.hardTimer);
    // 仅终止本次拥有的子进程，且保留订阅时长外的 30 秒清理窗口。
    this.hardTimer = clock.setTimeout(() => {
      if (this.isSettled) return;
      this.hasForcedTermination = true;
      try {
        this.child.kill();
      } catch {
        this.hasFailed = true;
      }
      this.killWaitTimer = clock.setTimeout(() => this.finish(null), 5000);
    }, this.settings.durationMs + 30_000);
  }

  private startObservation(): void {
    this.settings.clock.clearTimeout(this.readyTimer);
    if (this.isSettled || this.hasClosedStdin) return;
    this.armHardDeadline();
    // 观察时间从完整 ready 行开始，不能从进程启动时开始。
    this.durationTimer = this.settings.clock.setTimeout(
      () => this.stopGracefully(),
      this.settings.durationMs,
    );
  }

  private finish(code: number | null, signal: string | null = null): void {
    if (this.isSettled) return;
    this.isSettled = true;
    for (const timer of [this.readyTimer, this.durationTimer, this.hardTimer, this.killWaitTimer]) {
      if (timer !== undefined) this.settings.clock.clearTimeout(timer);
    }
    this.options.signal?.removeEventListener('abort', this.abort);
    this.parser.finish();
    this.resolve(this.createResult(code, signal));
  }

  private createResult(code: number | null, signal: string | null): ConsumeResult {
    return {
      ready: this.parser.ready,
      counts: { ...this.parser.counts },
      delivered: Object.values(this.parser.counts).some((count) => count > 0),
      normalExit:
        code === 0 &&
        !signal &&
        !this.hasForcedTermination &&
        !this.hasFailed &&
        !this.hasOutputLimitExceeded &&
        !this.parser.malformed &&
        !this.hasReadyTimedOut,
      forcedTermination: this.hasForcedTermination,
      readyTimedOut: this.hasReadyTimedOut,
      outputLimitExceeded: this.hasOutputLimitExceeded,
      malformed: this.parser.malformed,
      exitCode: code,
      subscriptionIds: this.parser.subscriptionIds,
    };
  }

  private abort = (): void => {
    this.hasFailed = true;
    this.stopGracefully();
  };

  private record(stream: 'stdout' | 'stderr', input: Buffer | string): void {
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const remaining = Math.max(0, this.settings.maxOutputBytes - this.bytes);
    this.bytes += chunk.length;
    try {
      if (remaining)
        appendFileSync(
          path.join(this.settings.logDir, `consume.${stream}.log`),
          chunk.subarray(0, remaining),
        );
    } catch {
      this.hasFailed = true;
      this.stopGracefully();
    }
    if (this.bytes > this.settings.maxOutputBytes) {
      this.hasOutputLimitExceeded = true;
      this.stopGracefully();
      return;
    }
    if (stream === 'stdout') this.parser.pushStdout(chunk);
    else this.parser.pushStderr(chunk);
  }
}

/**
 * 启动只订阅指定审批事件的有界子进程。
 * @param options 白名单事件、观察时长、身份与可注入运行配置。
 * @returns 就绪、事件计数、退出状态及内存中的订阅标识。
 * @throws Error 参数、可执行文件或资源配置无效，或进程无法启动。
 */
export async function consumeEvents(options: ConsumeOptions): Promise<ConsumeResult> {
  const settings = prepareSettings(options);
  return new Promise((resolve) => {
    const session = new EventSession(options, settings, resolve);
    session.start();
  });
}
