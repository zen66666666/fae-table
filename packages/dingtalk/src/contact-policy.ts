// 集中定义单据姓名查询允许的通讯录命令与输入边界，供白名单和批量解析共用。

/** 本轮唯一允许的通讯录只读命令。 */
export const CONTACT_NAME_COMMAND = 'contact user get';
/** 每次通讯录查询允许的最多成员数量，单位为人。 */
export const CONTACT_NAME_BATCH_SIZE = 20;
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_USER_IDS = new Set(['me', 'self', 'current', 'whoami']);

/**
 * 判断成员 ID 是否为可以直接交给精确查询的单一标识。
 * @param userId 从真实单据字段中提取的成员 ID。
 * @returns 仅含允许字符且不是 CLI 身份别名时为 true。
 * @throws 无。
 */
export function isContactUserId(userId: unknown): userId is string {
  // 禁止分隔符、空白和身份别名，避免一个单据字段扩展成其他查询目标。
  return (
    typeof userId === 'string' &&
    USER_ID_PATTERN.test(userId) &&
    !RESERVED_USER_IDS.has(userId.toLowerCase())
  );
}

/**
 * 校验逗号分隔的明确成员列表，不接受空项、重复项或超过批次上限的列表。
 * @param value --ids 的完整值。
 * @returns 所有成员 ID 均合法且数量在允许范围内时为 true。
 * @throws 无。
 */
export function hasValidContactIds(value: string | undefined): boolean {
  if (value === undefined) return false;
  const userIds = value.split(',');
  return (
    userIds.length <= CONTACT_NAME_BATCH_SIZE &&
    userIds.every(isContactUserId) &&
    new Set(userIds).size === userIds.length
  );
}
