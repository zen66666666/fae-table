// 按原始地址在当前账号范围内合并并缓存图片，供单据图片服务使用。
import { readTicketImage } from '../../../packages/dingtalk/src/index.ts';
import type { TicketImageAccess } from './ticket-service-types.ts';

const DEFAULT_IMAGE_CACHE_MAX_BYTES = 200 * 1024 * 1024;
type Image = NonNullable<Awaited<ReturnType<typeof readTicketImage>>>;

/** 按实际字节数限制的图片内存缓存；范围失效时取消在途请求并清空。 */
export class TicketImageCache {
  private readonly maxBytes: number;
  private readonly fetch: typeof fetch;
  private readonly entries = new Map<string, Image>();
  private readonly pending = new Map<string, Promise<Image | undefined>>();
  private controller = new AbortController();
  private bytes = 0;

  /**
   * 创建无磁盘状态的缓存和下载合并器。
   * @param options 已有图片安全读取使用的 fetch 与可注入的字节上限。
   * @throws RangeError 上限必须是非负安全整数。
   */
  constructor(options: { fetch: typeof fetch; maxBytes?: number }) {
    this.maxBytes = options.maxBytes ?? DEFAULT_IMAGE_CACHE_MAX_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0)
      throw new RangeError('图片缓存上限无效');
    this.fetch = options.fetch;
  }

  /**
   * 检查通过门禁的图片是否已经在内存，不改变图片访问顺序。
   * @param access 本次读取的私有地址和当前账号及详情门禁。
   * @returns 有权限且已缓存时为 true。
   * @throws 无预期错误。
   */
  has(access: TicketImageAccess): boolean {
    return !access.signal.aborted && access.canRead() && this.entries.has(access.url);
  }

  /**
   * 1. 检查当前权限。2. 读取内存或复用在途下载。3. 重新检查权限后返回图片。
   * @param access 本次读取的私有地址和当前账号及详情门禁。
   * @returns 已校验的图片；失败、越界访问或账号已变化时为 undefined。
   * @throws 无预期错误；外部请求失败由图片读取器消化。
   */
  async read(access: TicketImageAccess): Promise<Image | undefined> {
    const { url, canRead, signal } = access;
    if (signal.aborted || !canRead()) return; // 1.
    const cached = this.entries.get(url);
    if (cached) {
      this.entries.delete(url);
      this.entries.set(url, cached);
      return cached;
    }
    const scope = this.controller.signal;
    const image = await (this.pending.get(url) ?? this.download(url, scope)); // 2.
    // 3. 单据可能在网络请求期间离开列表；旧账号的迟到结果也绝不回填内存。
    if (!image || scope.aborted || signal.aborted || !canRead()) return;
    this.store(url, image);
    return image;
  }

  /**
   * 清空本账号的字节和在途下载，供切换、登出或退出使用。
   * @returns 无返回值；重置后可为新账号提供缓存。
   * @throws 无预期错误。
   */
  clear(): void {
    this.controller.abort();
    this.controller = new AbortController();
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }

  private download(url: string, signal: AbortSignal): Promise<Image | undefined> {
    // 单个浏览器标签页关闭不能取消其他读者共用的下载；账号范围失效时统一中止。
    let finish!: (image: Image | undefined) => void;
    const promise = new Promise<Image | undefined>((resolve) => {
      finish = resolve;
    });
    this.pending.set(url, promise);
    void readTicketImage({ url, fetch: this.fetch, signal })
      .catch(() => undefined)
      .then((image) => {
        if (this.pending.get(url) === promise) this.pending.delete(url);
        finish(image);
      });
    return promise;
  }

  private store(url: string, image: Image): void {
    const size = image.bytes.length;
    if (size > this.maxBytes || this.entries.has(url)) return;
    while (this.bytes + size > this.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) return;
      this.entries.delete(oldest[0]);
      this.bytes -= oldest[1].bytes.length;
    }
    this.entries.set(url, image);
    this.bytes += size;
  }
}
