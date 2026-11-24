// 只从官网固定下载地址读取并校验 PDF，供本地资料存储分块写入。
import { createHash } from 'node:crypto';
import { discardResponse } from '../../core/src/index.ts';
import { ManualDownloadError } from './download-error.ts';
import { getDownloadFileName } from './file-name.ts';
import { getManualDownloadUrl } from './links.ts';
import { isManualOfficialResponse, MANUAL_REQUEST_POLICY } from './official-response.ts';
import type { ManualRequestOptions } from './request.ts';

const PDF_TIMEOUT_MS = 30_000;
/** 官网下载与本机文本读取共用的标准 PDF 文件头。 */
export const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');
const RETRYABLE_RESPONSE_CODES = new Set([408, 429]);

/** 本机手册的最大 PDF 大小，包含解码后的响应正文。 */
export const MANUAL_PDF_LIMIT_BYTES = 60 * 1024 * 1024;

/** 已校验的文件内容信息；不包含响应正文或绝对路径。 */
export type VerifiedPdf = { fileName: string; size: number; sha256: string };

type PdfBody = NonNullable<Response['body']>;

function getLength(response: Response): number | undefined {
  const header = response.headers.get('Content-Length');
  if (header === null) return undefined;
  const length = /^\d+$/u.test(header) ? Number(header) : NaN;
  if (
    !Number.isSafeInteger(length) ||
    length < PDF_SIGNATURE.length ||
    length > MANUAL_PDF_LIMIT_BYTES
  ) {
    throw new ManualDownloadError('invalid-response');
  }
  return length;
}

function validateResponse(response: Response, address: URL): PdfBody {
  if (isManualOfficialResponse(response, address) && response.status === 200 && response.body)
    return response.body;
  if (response.status === 404 || response.status === 410)
    throw new ManualDownloadError('not-found');
  if (RETRYABLE_RESPONSE_CODES.has(response.status) || response.status >= 500) {
    throw new ManualDownloadError('network', true);
  }
  throw new ManualDownloadError('invalid-response');
}

async function readNext(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  try {
    return await reader.read();
  } catch {
    throw new ManualDownloadError('network', true);
  }
}

async function readPdf(options: {
  body: PdfBody;
  signal: AbortSignal;
  expectedSize?: number;
  append: (bytes: Uint8Array) => Promise<void>;
}): Promise<Pick<VerifiedPdf, 'size' | 'sha256'>> {
  // 1. 分块检查无损计数和开头签名。2. 哈希与暂存同步进行。3. EOF 处核实完整字节数。
  const reader = options.body.getReader();
  const checksum = createHash('sha256');
  let size = 0;
  let hasEnded = false;
  try {
    while (true) {
      options.signal.throwIfAborted();
      const item = await readNext(reader);
      if (item.done) {
        hasEnded = true;
        break;
      }
      const bytes = item.value;
      const signatureBytes = Math.min(Math.max(0, PDF_SIGNATURE.length - size), bytes.byteLength); // 1.
      const nextSize = size + bytes.byteLength;
      if (
        nextSize > MANUAL_PDF_LIMIT_BYTES ||
        (options.expectedSize !== undefined && nextSize > options.expectedSize) ||
        !PDF_SIGNATURE.subarray(size, size + signatureBytes).equals(
          bytes.subarray(0, signatureBytes),
        )
      ) {
        throw new ManualDownloadError('invalid-response');
      }
      size = nextSize;
      checksum.update(bytes); // 2.
      await options.append(bytes);
    }
    options.signal.throwIfAborted();
    if (
      size < PDF_SIGNATURE.length ||
      (options.expectedSize !== undefined && size !== options.expectedSize)
    ) {
      // 3.
      throw new ManualDownloadError('invalid-response');
    }
    return { size, sha256: checksum.digest('hex') };
  } finally {
    if (!hasEnded) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * GET 固定官网 PDF 下载地址并将经过大小和签名检查的内容分块交给临时文件。
 * @param options 已核实产品标识、型号、受限网络依赖和临时文件写入操作。
 * @returns 最终名称、实际字节和 SHA-256，只在完整验证后返回。
 * @throws ManualDownloadError 下载、文件名、正文或本地暂存失败。
 */
export async function downloadVerifiedPdf(
  options: ManualRequestOptions & {
    productId: string;
    model: string;
    append: (bytes: Uint8Array) => Promise<void>;
  },
): Promise<VerifiedPdf> {
  // 1. 仅连接官网固定地址。2. 在写盘前验证响应和名称。3. 核验完整流。
  const address = getManualDownloadUrl(options.productId); // 1.
  const timeout = (options.createTimeoutSignal ?? AbortSignal.timeout)(PDF_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    response = await (options.fetch ?? fetch)(address, {
      ...MANUAL_REQUEST_POLICY,
      headers: {
        Accept: 'application/pdf, application/octet-stream',
        'Accept-Encoding': 'identity',
      },
      signal,
    });
    const body = validateResponse(response, address); // 2.
    const expectedSize = getLength(response);
    const fileName = getDownloadFileName({
      disposition: response.headers.get('Content-Disposition'),
      model: options.model,
    });
    const pdf = await readPdf({ body, expectedSize, signal, append: options.append }); // 3.
    return { fileName, ...pdf };
  } catch (error) {
    if (response) discardResponse(response);
    if (error instanceof ManualDownloadError && error.writeFailure && !options.signal?.aborted)
      throw error;
    if (timeout.aborted) throw new ManualDownloadError('timeout', true);
    if (options.signal?.aborted) throw new ManualDownloadError('network');
    if (error instanceof ManualDownloadError) throw error;
    throw new ManualDownloadError('network', true);
  }
}
