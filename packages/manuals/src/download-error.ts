// 定义文件下载和存取的安全错误，供后台显示结果及判断是否自动重试。
import type { CatalogWriteFailureReason } from '../../core/src/index.ts';

/** 本地手册取用的固定错误类别；不包含远端响应正文和本机文件路径。 */
export type ManualDownloadReason =
  | 'not-found'
  | 'invalid-response'
  | 'timeout'
  | 'network'
  | 'invalid-filename'
  | 'storage';

type ManualDownloadErrorOptions = { writeFailure?: CatalogWriteFailureReason };

/** 只公开安全分类、可重试标记及已确认的资料目录写入失败。 */
export class ManualDownloadError extends Error {
  readonly reason: ManualDownloadReason;
  readonly isRetryable: boolean;
  readonly writeFailure?: CatalogWriteFailureReason;

  /**
   * 构造不引用原始异常的错误。
   * @param reason 固定错误类别。
   * @param options 暂时失败标记，或仅由实际资料目录写入操作报告的安全原因。
   * @throws 无预期错误。
   */
  constructor(reason: ManualDownloadReason, options: boolean | ManualDownloadErrorOptions = false) {
    super(reason);
    this.reason = reason;
    this.isRetryable = typeof options === 'boolean' && options;
    this.writeFailure = typeof options === 'object' ? options.writeFailure : undefined;
  }
}

/**
 * 阻止已停止的手册存储范围再启动文件操作或发布结果。
 * @param signal 实例关闭或目录切换使用的停止信号。
 * @returns 范围有效时无返回值。
 * @throws ManualDownloadError 已停止时抛出无需自动重试的错误。
 */
export function assertManualStoreActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ManualDownloadError('network');
}
