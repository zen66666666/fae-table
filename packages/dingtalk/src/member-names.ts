// 读取明确成员的通讯录姓名并立即投影，供内存姓名缓存使用，不保留其他个人资料。
import { isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import type { Run } from './common.ts';
import { CONTACT_NAME_COMMAND, hasValidContactIds, isContactUserId } from './contact-policy.ts';

/**
 * 校验本机 CLI 已确认的通讯录结果列表契约。
 * @param data 已解析的 CLI 对象封装。
 * @returns result 为成员对象数组且成员模型结构合法时为 true。
 * @throws 无。
 */
export function hasValidMemberNamesPayload(data: JsonObject): boolean {
  return (
    Array.isArray(data.result) &&
    data.result.every(
      (entry) =>
        isObject(entry) &&
        isObject(entry.orgEmployeeModel) &&
        isContactUserId(entry.orgEmployeeModel.orgUserId) &&
        (entry.orgEmployeeModel.orgUserName == null ||
          typeof entry.orgEmployeeModel.orgUserName === 'string'),
    )
  );
}

function projectMemberNames(data: JsonObject, userIds: readonly string[]): Map<string, string> {
  const requested = new Set(userIds);
  const names = new Map<string, string>();
  for (const entry of data.result as JsonObject[]) {
    const employee = entry.orgEmployeeModel as JsonObject;
    const userId = employee.orgUserId;
    const name = employee.orgUserName;
    // 只接受这批明确请求的成员，不保存部门、手机号或 CLI 顺带返回的其他人员。
    if (typeof userId === 'string' && requested.has(userId) && typeof name === 'string') {
      if (name.trim()) names.set(userId, name.trim());
    }
  }
  return names;
}

/**
 * 读取一批精确成员并只提取姓名；查询错误不会影响单据主体的可用性。
 * @param options 当前无日志执行器、核实账号和最多二十个成员 ID。
 * @returns ID 到姓名映射；权限、格式或进程失败时返回空映射。
 * @throws 无；不输出任何原始错误或通讯录字段。
 */
export async function readMemberNames(options: {
  run: Run;
  profile: string;
  userIds: readonly string[];
}): Promise<ReadonlyMap<string, string>> {
  if (!hasValidContactIds(options.userIds.join(','))) return new Map();
  try {
    const result = await options.run([
      ...CONTACT_NAME_COMMAND.split(' '),
      '--ids',
      options.userIds.join(','),
      '--profile',
      options.profile,
      '-f',
      'json',
    ]);
    if (
      result.kind !== 'success' ||
      !isObject(result.data) ||
      !hasValidMemberNamesPayload(result.data)
    ) {
      return new Map();
    }
    return projectMemberNames(result.data, options.userIds);
  } catch {
    return new Map();
  }
}
