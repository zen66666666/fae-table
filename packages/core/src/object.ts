// 提供统一的 JSON 对象类型及运行时判断，避免各业务模块重复实现。

/** JSON 对象的键值结构；值仍需由调用者按业务契约校验。 */
export type JsonObject = Record<string, unknown>;

/**
 * 判断值是否为非空、非数组的对象。
 * @param value 待判断的值。
 * @returns 是否可作为键值对象访问。
 * @throws 不抛出错误。
 */
export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 将未知值视为对象，其他类型返回空对象。
 * @param value 待转换的值。
 * @returns 原对象或空对象。
 * @throws 不抛出错误。
 */
export function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}
