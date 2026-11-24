// 校验审批详情结构，并提取不会泄露业务内容的字段名与附件状态。
import { AppError, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';

const FIELD_NAMES = new Set([
  'attachedProcessInstanceIds',
  'businessId',
  'createTime',
  'formValueVOS',
  'operationRecords',
  'originatorDeptId',
  'originatorDeptName',
  'originatorUserid',
  'processCode',
  'processInstanceId',
  'processInstanceResult',
  'processInstanceTitle',
  'status',
  'tasks',
  'taskIdList',
  'taskId',
  'taskResult',
  'taskStatus',
  'userId',
  'operationResult',
  'operationTime',
  'operationType',
  'activityId',
  'attachments',
  'ccUserIds',
  'date',
  'images',
  'remark',
  'result',
  'showName',
  'type',
  'bizAlias',
  'componentType',
  'details',
  'extValue',
  'id',
  'name',
  'value',
]);

/**
 * 提取允许公开的结构字段名，忽略表单标签和动态对象键。
 * @param payload 已校验的审批返回体。
 * @returns 去重并排序的白名单字段名。
 * @throws 无；未知字段被忽略。
 */
export function collectFieldNames(payload: JsonObject): string[] {
  const found = new Set(Object.keys(payload).filter((key) => FIELD_NAMES.has(key)));
  // 只检查已知集合的结构键，避免将客户填写的内容作为字段名输出。
  for (const key of ['formValueVOS', 'operationRecords', 'tasks', 'taskIdList']) {
    if (Array.isArray(payload[key])) {
      for (const entry of payload[key]) {
        if (isObject(entry)) {
          for (const name of Object.keys(entry)) {
            if (FIELD_NAMES.has(name)) found.add(name);
          }
        }
      }
    }
  }
  return [...found].sort();
}

/**
 * 核对审批结果对象及其归属，详情读取和写入证据采集共用。
 * @param options CLI 封装、白名单里的查询和本次审批实例。
 * @returns 本目标实例的结果对象。
 * @throws AppError 结果不是对象或详情、记录不属于请求实例。
 */
export function parseApprovalResult(options: {
  envelope: JsonObject;
  leaf: string;
  instanceId: string;
}): JsonObject {
  const { envelope, leaf, instanceId } = options;
  const payload = envelope.result;
  if (!isObject(payload)) throw new AppError('structure', 'invalid_result', leaf);
  if (leaf !== 'tasks' && payload.processInstanceId !== instanceId) {
    throw new AppError('structure', 'instance_mismatch', leaf);
  }
  return payload;
}

/**
 * 校验详情、记录或任务接口的返回体与所属实例。
 * @param envelope CLI 返回的完整对象。
 * @param leaf 白名单内的审批查询子命令。
 * @param instanceId 本次查询的审批实例标识。
 * @returns 已通过结构及实例一致性检查的返回体。
 * @throws AppError 返回结构异常、任务标识无效或实例不匹配时抛出。
 */
export function parseDetailPayload(
  envelope: JsonObject,
  leaf: string,
  instanceId: string,
): JsonObject {
  const payload = parseApprovalResult({ envelope, leaf, instanceId });
  const collection =
    leaf === 'detail' ? 'formValueVOS' : leaf === 'records' ? 'operationRecords' : 'taskIdList';
  const entries = payload[collection];
  if (!Array.isArray(entries) || !entries.every(isObject)) {
    throw new AppError('structure', 'invalid_collection', leaf);
  }
  if (
    leaf === 'detail' &&
    (typeof payload.processCode !== 'string' ||
      !payload.processCode ||
      !Array.isArray(payload.tasks) ||
      !payload.tasks.every(isObject))
  ) {
    throw new AppError('structure', 'invalid_detail', leaf);
  }
  if (
    leaf === 'tasks' &&
    !entries.every((task) => typeof task.taskId === 'string' || typeof task.taskId === 'number')
  ) {
    throw new AppError('structure', 'invalid_task_id', leaf);
  }
  return payload;
}

/**
 * 判断原生数组或 JSON 数组字符串中是否存在附件。
 * @param value 接口返回的附件字段值。
 * @returns 非空数组返回 true，其余格式返回 false。
 * @throws 无；无法解析的字符串视为没有可识别附件。
 */
export function hasNonemptyAttachment(value: unknown): boolean {
  return (parseAttachmentItems(value)?.length ?? 0) > 0;
}

/**
 * 解析附件接口已有的数组或 JSON 数组字符串，供探针和网页投影复用。
 * @param value 接口返回的附件字段值。
 * @returns 数组结构；无法识别时返回 null，不透传原始字符串。
 * @throws 无；JSON 解析失败被转换为 null。
 */
export function parseAttachmentItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}
