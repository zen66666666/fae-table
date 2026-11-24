// 为资料下载复用和本机文本提取验证 PDF 字节、长度与摘要。
import { createHash } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import type { Readable } from 'node:stream';
import { MANUAL_PDF_LIMIT_BYTES, PDF_SIGNATURE } from './pdf-request.ts';
import type { ManualTextSource } from './text-types.ts';

const MIN_PDF_BYTES = PDF_SIGNATURE.length;

/** 持久化索引和文本源共用的小写 SHA-256 校验格式。 */
export const PDF_SHA256_PATTERN = /^[a-f\d]{64}$/u;

type VerifiedInput = { kind: 'verified'; bytes?: Uint8Array };
type ReadInput = VerifiedInput | { kind: 'invalid' | 'too-large' | 'unavailable' };

/**
 * 核实实际流的 PDF 文件头、长度和 SHA-256；需要解析时才保留字节。
 * @param options 文件元数据、已核实的句柄流和是否保留字节。
 * @returns 通过校验的输入或文件内容不符状态。
 * @throws 流读取失败时传递错误；调用者负责销毁流。
 */
export async function verifyPdfStream(options: {
  stream: Readable;
  size: number;
  sha256: string;
  shouldKeepBytes?: boolean;
}): Promise<VerifiedInput | { kind: 'invalid' }> {
  // 1. 按长度上限消费实际字节。2. 验证开头和完整摘要。
  const { stream, size, sha256, shouldKeepBytes } = options;
  const hash = createHash('sha256');
  // 缓存或下载复用时只计算摘要；待解析的字节写入可转移的独立数组。
  const bytes = shouldKeepBytes ? new Uint8Array(size) : undefined;
  const signature = Buffer.alloc(MIN_PDF_BYTES);
  let read = 0;
  for await (const chunk of stream) {
    // 1. 累计读取量不能超过已经核实的索引大小。
    if (!(chunk instanceof Uint8Array) || read + chunk.byteLength > size)
      return { kind: 'invalid' };
    if (read < MIN_PDF_BYTES) signature.set(chunk.subarray(0, MIN_PDF_BYTES - read), read);
    hash.update(chunk);
    bytes?.set(chunk, read);
    read += chunk.byteLength;
  }
  // 2. 即使文件以同名同大小替换，摘要不等也不能命中旧文本或复用为下载结果。
  if (read !== size || !signature.equals(PDF_SIGNATURE) || hash.digest('hex') !== sha256)
    return { kind: 'invalid' };
  return { kind: 'verified', bytes };
}

function openBeforeAbort(options: {
  source: ManualTextSource;
  signal: AbortSignal;
}): Promise<Readable | undefined> {
  const { source, signal } = options;
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    const complete = (stream?: Readable) => {
      signal.removeEventListener('abort', abort);
      // 超时之后打开的句柄也必须关闭，避免本机文件系统迟迟未返回时占住并发名额。
      if (signal.aborted) stream?.destroy();
      else resolve(stream);
    };
    void Promise.resolve()
      .then(() => source.open())
      .then(complete, () => complete());
  });
}

/**
 * 打开有界的文本源，并在取消和截止时间内验证文件字节。
 * @param options 已索引文件、取消信号及是否已经缓存文本。
 * @returns 已验证的输入或固定的文件状态。
 * @throws 无预期错误，读取失败返回 unavailable。
 */
export async function readVerifiedPdf(options: {
  source: ManualTextSource;
  signal: AbortSignal;
  hasCachedText: boolean;
}): Promise<ReadInput> {
  // 1. 核实索引边界。2. 打开只读句柄并验证字节。3. 清理句柄。
  const { source, signal, hasCachedText } = options;
  if (source.size > MANUAL_PDF_LIMIT_BYTES) return { kind: 'too-large' }; // 1.
  if (
    !Number.isSafeInteger(source.size) ||
    source.size < MIN_PDF_BYTES ||
    !PDF_SHA256_PATTERN.test(source.sha256)
  )
    return { kind: 'invalid' };

  const stream = await openBeforeAbort(options); // 2.
  if (!stream) return { kind: 'unavailable' };
  try {
    addAbortSignal(signal, stream);
    return await verifyPdfStream({ ...source, stream, shouldKeepBytes: !hasCachedText });
  } catch {
    return { kind: 'unavailable' };
  } finally {
    stream.destroy(); // 3.
  }
}
