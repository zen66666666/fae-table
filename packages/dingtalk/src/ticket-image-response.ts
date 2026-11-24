// 从钉钉图片地址读取有界正文，供受保护的单据图片路由使用。
import { discardResponse, readBoundedResponseBytes } from '../../core/src/index.ts';

const IMAGE_HOST_SUFFIX = '.dingtalk.com';
const IMAGE_TIMEOUT_MS = 15_000;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const IMAGE_REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const IMAGE_MAX_REDIRECTS = 2;

function readImageAddress(value: string, base?: URL): URL | undefined {
  try {
    const address = new URL(value, base);
    // 来源地址由钉钉记录提供，仍须拒绝其他主机和带凭据的地址，避免访问无关服务。
    if (
      address.protocol === 'https:' &&
      address.hostname.length > IMAGE_HOST_SUFFIX.length &&
      address.hostname.endsWith(IMAGE_HOST_SUFFIX) &&
      !address.username &&
      !address.password
    )
      return address;
  } catch {
    // 无效地址不能进入出站请求，也不能出现在错误响应里。
  }
}

async function requestImage(options: {
  address: URL;
  fetch: typeof fetch;
  signal: AbortSignal;
}): Promise<Response | undefined> {
  const { address, signal } = options;
  let current = address;
  for (let redirects = 0; redirects <= IMAGE_MAX_REDIRECTS; redirects++) {
    signal.throwIfAborted();
    const response = await options.fetch(current, {
      credentials: 'omit',
      redirect: 'manual',
      signal,
    });
    if (!IMAGE_REDIRECT_CODES.has(response.status)) return response;
    discardResponse(response);
    const location = response.headers.get('Location');
    const next = location ? readImageAddress(location, current) : undefined;
    // 手动检查每一次跳转，禁止跨主机转发；同源跳转也受固定次数和总超时限制。
    if (!next || next.origin !== address.origin) return;
    current = next;
  }
}

function getImageType(response: Response, address: URL): string | undefined {
  const contentType = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
  const length = response.headers.get('Content-Length');
  const size = length === null ? undefined : Number(length);
  if (
    response.status === 200 &&
    !response.redirected &&
    (!response.url || new URL(response.url).origin === address.origin) &&
    contentType &&
    IMAGE_CONTENT_TYPES.has(contentType) &&
    (size === undefined || (Number.isSafeInteger(size) && size > 0 && size <= IMAGE_MAX_BYTES))
  )
    return contentType;
}

/**
 * 1. 验证地址后匿名取图。2. 校验响应类型及长度。3. 完整读完后才能交付字节。
 * @param options 快照地址、通用 fetch 依赖和本次访问的取消信号。
 * @returns 内存中的图片类型和正文；读取失败时为 undefined，不写入磁盘。
 * @throws 无预期错误；外部响应和原始异常不会进入本机接口。
 */
export async function readTicketImage(options: {
  url: string;
  fetch: typeof fetch;
  signal: AbortSignal;
}): Promise<{ contentType: string; bytes: Buffer } | undefined> {
  const address = readImageAddress(options.url);
  if (!address || options.signal.aborted) return; // 1.
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(IMAGE_TIMEOUT_MS)]);
  let response: Response | undefined;
  try {
    response = await requestImage({ address, fetch: options.fetch, signal }); // 1.
    if (!response) return;
    const contentType = getImageType(response, address); // 2.
    if (!contentType) return;
    const bytes = await readBoundedResponseBytes({ response, maxBytes: IMAGE_MAX_BYTES, signal }); // 3.
    return bytes.length ? { contentType, bytes } : undefined;
  } catch {
    return undefined;
  } finally {
    if (response) discardResponse(response);
  }
}
