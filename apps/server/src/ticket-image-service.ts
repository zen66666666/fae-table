// 协调单据图片的按需读取和后台预取，两者共用同一权限门禁及内存缓存。
import { isTicketFinished } from '../../../packages/core/src/index.ts';
import type { TicketDetail } from '../../../packages/core/src/index.ts';
import { TicketImageCache } from './ticket-image-cache.ts';
import type { TicketImageAccess, TicketImageInput } from './ticket-service-types.ts';

const IMAGE_PREFETCH_CONCURRENCY = 2;

type ImageRead = NonNullable<Awaited<ReturnType<TicketImageCache['read']>>> & {
  canRead: () => boolean;
};

type ImageServiceOptions = {
  getAccess: (input: TicketImageInput, isPrefetch?: boolean) => TicketImageAccess | undefined;
  fetch: typeof fetch;
  maxBytes?: number;
  schedule: (callback: () => void) => void;
};

/** 面向一个工作台的图片读取入口，预取不阻塞详情，也不使用独立下载路径。 */
export class TicketImageService {
  private readonly cache: TicketImageCache;
  private readonly options: ImageServiceOptions;
  private readonly queued = new Map<string, TicketImageInput>();
  private readonly inFlight = new Set<string>();
  private pendingDrain?: () => void;

  /**
   * 初始化当前工作台的图片缓存和预取队列，构造时不读取外部服务。
   * @param options 门禁、缓存字节预算及可替换的网络和调度依赖。
   * @throws 注入的缓存上限无效时抛出 RangeError。
   */
  constructor(options: ImageServiceOptions) {
    this.options = options;
    this.cache = new TicketImageCache(options);
  }

  /**
   * 通过当前列表和详情许可读取图片，供浏览器和后台预取共用。
   * @param input 当前单据和不透明图片编号。
   * @param isPrefetch 后台预取还需检查单据没有结束。
   * @returns 图片及发送响应前可再检查的许可；无权限或读取失败时为 undefined。
   * @throws 无预期错误；网络错误不会暴露给网页或通知接口。
   */
  async read(input: TicketImageInput, isPrefetch = false): Promise<ImageRead | undefined> {
    const access = this.options.getAccess(input, isPrefetch);
    if (!access) return;
    const image = await this.cache.read(access);
    return image && access.canRead() ? { ...image, canRead: access.canRead } : undefined;
  }

  /**
   * 为新读到的未结束单据排队预取未缓存图片。
   * @param detail 已写入当前详情缓存的快照，失效或结束的单据不安排任务。
   * @returns 无返回值；实际下载在后续事件循环执行。
   * @throws 无预期错误；调度失败时可随下次详情读取继续。
   */
  warm(detail: TicketDetail): void {
    const { id } = detail.summary;
    if (isTicketFinished(detail.summary)) return;
    for (const { imageIds } of detail.records) {
      for (const imageId of imageIds ?? []) {
        if (this.queued.has(imageId) || this.inFlight.has(imageId)) continue;
        const input = { id, imageId };
        const access = this.options.getAccess(input, true);
        if (access && !this.cache.has(access)) this.queued.set(imageId, input);
      }
    }
    this.scheduleDrain();
  }

  /**
   * 清理离开账号范围的缓存和等待任务，供账号变更、登出与退出使用。
   * @returns 无返回值；已取消的下载释放实际并发位置后再接新任务。
   * @throws 无预期错误。
   */
  clear(): void {
    this.pendingDrain = undefined;
    this.queued.clear();
    this.cache.clear();
  }

  private scheduleDrain(): void {
    if (this.pendingDrain || !this.queued.size || this.inFlight.size >= IMAGE_PREFETCH_CONCURRENCY)
      return;
    const drain = () => {
      // 账号失效后，已排队的回调不能代替新范围的任务调度。
      if (this.pendingDrain !== drain) return;
      this.pendingDrain = undefined;
      this.drain();
    };
    this.pendingDrain = drain;
    try {
      this.options.schedule(drain);
    } catch {
      // 预取失败不能让已经读完的单据详情变成失败。
      if (this.pendingDrain === drain) this.pendingDrain = undefined;
    }
  }

  private drain(): void {
    while (this.inFlight.size < IMAGE_PREFETCH_CONCURRENCY) {
      const input = this.queued.values().next().value;
      if (!input) return;
      const { imageId } = input;
      this.queued.delete(imageId);
      // 排队期间可能已结束或离开当前列表；read 还会重新核对编号是否仍存在。
      this.inFlight.add(imageId);
      void this.read(input, true)
        .catch(() => undefined)
        .finally(() => {
          this.inFlight.delete(imageId);
          this.scheduleDrain();
        });
    }
  }
}
