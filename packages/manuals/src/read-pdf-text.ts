// 管理限时 PDF.js 线程和资源释放，供手册文本索引使用。
import { Worker } from 'node:worker_threads';
import { PDF_WORKER_MEMORY_MB } from './text-limits.ts';
import type { ParsedManualText } from './text-types.ts';

const WORKER_URL = new URL('./pdf-text-worker.ts', import.meta.url);

/**
 * 运行独立 PDF.js 线程；到达读取超时或请求取消时终止线程。
 * @param options 完整验证的 PDF 字节和信号；字节的底层缓冲区会转移所有权。
 * @returns 文本页或固定的失败状态，解析器输出不写入后台日志。
 * @throws 无预期错误，无法启动或解析时返回 invalid。
 */
export async function parseVerifiedPdf(options: {
  bytes: Uint8Array;
  signal: AbortSignal;
}): Promise<ParsedManualText> {
  // 1. 隔离线程与日志。2. 等待文本或取消。3. 确定线程结束后释放索引的执行名额。
  const { bytes, signal } = options;
  if (signal.aborted) return { kind: 'unavailable' };
  let worker: Worker | undefined;
  try {
    worker = new Worker(WORKER_URL, {
      // 1. 线程无需后台环境变量或启动参数，第三方的警告也不能记录本机路径。
      workerData: bytes,
      transferList: [bytes.buffer as ArrayBuffer],
      env: {},
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB },
      stdout: true,
      stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    return await waitForWorker({ worker, signal }); // 2.
  } catch {
    return { kind: 'invalid' };
  } finally {
    await worker?.terminate().catch(() => undefined); // 3.
  }
}

function waitForWorker(options: {
  worker: Worker;
  signal: AbortSignal;
}): Promise<ParsedManualText> {
  const { worker, signal } = options;
  return new Promise((resolve) => {
    const finish = (result: ParsedManualText): void => {
      signal.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish({ kind: 'unavailable' });
    worker.once('message', finish);
    worker.once('error', () => finish({ kind: 'invalid' }));
    worker.once('exit', () => finish({ kind: 'invalid' }));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
