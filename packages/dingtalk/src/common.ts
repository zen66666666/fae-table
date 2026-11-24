// 为钉钉探针提供统一的调用类型和成功结果校验。
import { AppError, asObject, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import type { RunnerResult } from './runner-types.ts';

export { newRunDir } from './runtime-directory.ts';
export { parseArguments } from './probe-arguments.ts';

/**
 * 执行一条受白名单约束的钉钉命令。
 * @param argv 命令及参数数组。
 * @returns 已分类的调用结果。
 * @throws 由注入的执行函数决定；默认执行器以失败结果报告错误。
 */
export type Run = (argv: string[]) => Promise<RunnerResult>;

/**
 * 提取成功调用中的对象数据，供具体业务契约进一步校验。
 * @param result 已分类的调用结果。
 * @param operation 用于标注失败的操作名称。
 * @returns 成功结果中的对象数据。
 * @throws AppError：调用失败或返回值不是对象。
 */
export function mustSucceed(result: RunnerResult, operation: string): JsonObject {
  if (result.kind !== 'success') {
    throw new AppError(
      result.error?.type ?? 'parse',
      result.error?.subtype ?? 'invalid_json',
      operation,
    );
  }
  if (!isObject(result.data)) {
    throw new AppError('structure', 'expected_object', operation);
  }
  return result.data;
}

/**
 * 判断列表或记录是否没有已知的截断、游标或分页残留。
 * @param payload 已从钉钉返回体解析的对象。
 * @returns 未发现结果不完整标记时为 true。
 * @throws 无预期错误。
 */
export function isCompleteDingtalkResult(payload: JsonObject): boolean {
  return [payload, asObject(payload.pagination)].every(
    (part) =>
      part.complete !== false &&
      part.hasMore !== true &&
      part.truncated !== true &&
      !part.nextCursor &&
      !part.nextToken,
  );
}
