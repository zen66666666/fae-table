// 为官网查询和资料下载提供相同的有界并发与单键任务合并。
type Job = () => Promise<void>;

/** 按业务键去重的本实例队列，不保存任务完成后的结果。 */
export class ManualTaskQueue<Key, Result> {
  private readonly limit: number;
  private readonly pending = new Map<Key, Promise<Result>>();
  private readonly jobs: Job[] = [];
  private activeCount = 0;

  /**
   * 创建具有固定并发上限的队列。
   * @param limit 同时允许启动的操作数，由模块常量提供。
   * @throws 无预期错误。
   */
  constructor(limit: number) {
    this.limit = limit;
  }

  /**
   * 获取相同键已排队或执行中的结果。
   * @param key 已核验的官网型号或产品编号。
   * @returns 在途任务，未安排时返回 undefined。
   * @throws 无预期错误。
   */
  getPending(key: Key): Promise<Result> | undefined {
    return this.pending.get(key);
  }

  /**
   * 复用相同键的任务，或排入新的操作。
   * @param key 用于合并的业务键。
   * @param run 同一键仅由最新首次排队的调用启动操作。
   * @returns 同一任务的计算结果。
   * @throws 操作失败时由返回的 Promise 继续传递错误。
   */
  enqueue(key: Key, run: () => Promise<Result>): Promise<Result> {
    const current = this.getPending(key);
    if (current) return current;
    const result = new Promise<Result>((resolve, reject) => {
      this.jobs.push(async () => {
        try {
          resolve(await run());
        } catch (error) {
          reject(error);
        } finally {
          this.pending.delete(key);
          this.activeCount--;
          this.startJobs();
        }
      });
    });
    this.pending.set(key, result);
    this.startJobs();
    return result;
  }

  private startJobs(): void {
    while (this.activeCount < this.limit) {
      const job = this.jobs.shift();
      if (!job) return;
      this.activeCount++;
      void job();
    }
  }
}
