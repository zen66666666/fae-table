// 提供有界的 HTTP 响应正文读取和取消，由出站网络模块复用。
import { AppError } from './app-error.ts';

/**
 * 关闭无须处理的响应正文，尽快释放底层连接。
 * @param response 要取消正文的响应。
 * @returns 无返回值。
 * @throws 忽略已经关闭或中止的流错误。
 */
export function discardResponse(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/**
 * 按实际字节数读取响应，超限或截止时取消剩余正文。
 * @param options 已取得的响应、解码后字节上限和可选取消信号。
 * @returns 已读取的完整正文；没有正文时返回空缓冲区。
 * @throws AppError 超过资源上限；传输和取消错误由流或信号抛出。
 */
export async function readBoundedResponseBytes(options: {
  response: Response;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<Buffer> {
  // 1. 按流累计实际字节。2. 完整读完后合并并释放读取锁。
  const { response, maxBytes, signal } = options;
  signal?.throwIfAborted();
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  let hasEnded = false;
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    // 1. 不依赖 Content-Length，压缩响应也须受解压后的正文上限约束。
    while (true) {
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) {
        hasEnded = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new AppError('protocol', 'response_too_large', 'http-response');
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size); // 2.
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!hasEnded) cancel();
    reader.releaseLock();
  }
}

/**
 * 以 UTF-8 解码有大小限制的响应正文，供官网和 AI 客户端解析。
 * @param response 已取得的 HTTP 响应。
 * @param maxBytes 解码后的最大字节数。
 * @returns 正文文本，无正文时返回空字符串。
 * @throws AppError 超限；底层流可能抛出传输错误。
 */
export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const bytes = await readBoundedResponseBytes({ response, maxBytes });
  return bytes.toString('utf8');
}
