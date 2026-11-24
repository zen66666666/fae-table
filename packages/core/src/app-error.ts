// 定义统一业务错误与可安全输出到摘要的错误类型白名单。
import { asObject } from './object.ts';
import type { CatalogWriteFailureReason } from './connection-types.ts';

const WRITE_PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);
const WRITE_SPACE_CODES = new Set(['ENOSPC', 'EDQUOT']);

/** 可公开的错误类型；未知内容只能映射为 unknown，避免泄露原始返回。 */
export const ERROR_TYPES = new Set([
  'authentication',
  'identity',
  'structure',
  'validation',
  'policy',
  'permission',
  'authorization',
  'process',
  'protocol',
  'configuration',
  'network',
  'transport',
  'business',
  'api',
  'parse',
]);

/** 仅携带错误类型、子类型和操作名的业务错误，不保存原始业务数据。 */
export class AppError extends Error {
  type: string;
  subtype: string;
  operation: string;

  /**
   * 构造可分类的业务错误。
   * @param type 错误类型。
   * @param subtype 错误子类型。
   * @param operation 失败的操作。
   * @throws 不抛出额外错误。
   */
  constructor(type: string, subtype: string, operation: string) {
    super(`${type}:${subtype}`);
    this.type = type;
    this.subtype = subtype;
    this.operation = operation;
  }
}

/**
 * 提取白名单中的错误类型，阻止任意错误文本进入脱敏摘要。
 * @param error 待分类的错误对象。
 * @returns 已知错误类型或 unknown。
 * @throws 不抛出错误。
 */
export function errorType(error: unknown): string {
  const type = asObject(error).type;
  return typeof type === 'string' && ERROR_TYPES.has(type) ? type : 'unknown';
}

/**
 * 在已确认的资料文件写入操作失败后，投影权限或空间原因。
 * @param error 本机文件系统异常，调用方须先确认操作是写入资料目录。
 * @returns 固定拒绝原因，未识别的错误返回 undefined。
 * @throws 无预期错误。
 */
export function getCatalogWriteFailure(error: unknown): CatalogWriteFailureReason | undefined {
  const { code } = asObject(error);
  if (typeof code !== 'string') return undefined;
  if (WRITE_PERMISSION_CODES.has(code)) return 'folder-not-writable';
  if (WRITE_SPACE_CODES.has(code)) return 'folder-disk-full';
  return undefined;
}
