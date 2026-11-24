// 定位仓库根目录并限制钉钉原始输出的落盘位置。
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录的绝对路径，不随命令启动目录变化。 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * 创建并返回仓库运行数据目录。
 * @param logDir 可选日志目录，相对路径以仓库根目录为基准。
 * @returns 位于 .runtime 下的绝对路径。
 * @throws 路径越界或创建目录失败时抛错。
 */
export function runtimeDirectory(logDir?: string): string {
  const runtime = path.join(REPO_ROOT, '.runtime');
  const selected = logDir ? path.resolve(REPO_ROOT, logDir) : path.join(runtime, 'dws-calls');
  const relative = path.relative(runtime, selected);
  // 原始业务输出只能写入被 Git 忽略的运行数据目录。
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('DWS logs must stay under repository .runtime');
  mkdirSync(selected, { recursive: true });
  return selected;
}

/**
 * 为一轮探针创建独立的原始输出目录。
 * @param kind 探针类别。
 * @returns 本轮运行目录的绝对路径。
 * @throws 创建目录失败时抛出文件系统错误。
 */
export function newRunDir(kind: 'dingtalk-probe' | 'dingtalk-event'): string {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const directory = path.join(REPO_ROOT, '.runtime', kind, runId);
  mkdirSync(directory, { recursive: true });
  return directory;
}
