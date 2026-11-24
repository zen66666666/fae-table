// 约束只读探针对外输出的模板范围与脱敏摘要字段。
import { AppError, isObject, TICKET_TEMPLATES } from '../../core/src/index.ts';

/** 当前允许抽样的两类技术支持流程名称。 */
export const TEMPLATE_NAMES = [TICKET_TEMPLATES.fast, TICKET_TEMPLATES.service] as const;

/** 摘要字段白名单，防止原始审批字段意外进入终端输出。 */
export const SUMMARY_KEYS = new Set([
  'pending',
  'cc',
  'pages',
  'page',
  'success',
  'count',
  'hasMore',
  'endpointExhausted',
  'nextPage',
  'maxPagesReached',
  'incomplete',
  'templates',
  'templateName',
  'processCode',
  'samples',
  'instanceHash',
  'detail',
  'records',
  'tasks',
  'fields',
  'errorType',
  'hasModelField',
  'hasAttachments',
  'hasCurrentTask',
  'currentUserIsTaskActor',
  'instanceIdDiffersFromTaskId',
]);

/**
 * 递归检查摘要中的对象键是否在允许范围内。
 * @param value 待输出的脱敏摘要或其子项。
 * @returns 校验成功时无返回值。
 * @throws AppError 发现未允许的摘要键时抛出结构错误。
 */
export function assertSummaryKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertSummaryKeys);
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (!SUMMARY_KEYS.has(key)) throw new AppError('structure', 'unsafe_summary', 'summary');
      assertSummaryKeys(child);
    }
  }
}
