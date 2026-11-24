// 定义跨连接模块复用的进程依赖与有界执行结果。
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { StopProcessOptions, stopProcess } from './process-scope.ts';

/**
 * 用参数数组启动子进程的可替换依赖。
 * @param file 可执行文件路径。
 * @param args 独立的命令参数。
 * @param options 进程工作目录和输入输出等设置。
 * @returns 自有子进程；操作系统拒绝启动时可能抛错。
 */
export type SpawnProcess = (file: string, args: string[], options: SpawnOptions) => ChildProcess;

/** 可替换的计时器，用于执行超时和关闭等待。 */
export type ProcessClock = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };

/** 有界进程运行配置；调用方负责限制可执行文件和命令范围。 */
export type ProcessOptions = {
  file: string;
  args: readonly string[];
  spawn?: SpawnProcess;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  clock?: ProcessClock;
  isStdinKeptOpen?: boolean;
  /** 独立写入子进程标准输入的数据；写入后关闭输入流。 */
  stdin?: string;
  canCaptureOutput?: boolean;
  stop?: typeof stopProcess;
  /** 默认优雅停止；只读兼容调用可选择立即终止并保留原有等待上限。 */
  stopOptions?: StopProcessOptions;
  /** 默认停止自有进程；兼容旧调用时可在进程错误事件到达后立即结束。 */
  processErrorPolicy?: 'stop' | 'finish';
};

/** 原始进程结果仅供模块内部解析，不能直接返回网页或打印到终端。 */
export type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  failure: 'timeout' | 'spawn' | 'output-limit' | 'aborted' | null;
};
