// 为当前读取范围生成不透明的单据图片编号，供详情投影使用。
import { createHmac, randomBytes } from 'node:crypto';
import type { Identity } from './identity.ts';

const IMAGE_KEY_BYTES = 32;
const IMAGE_HMAC_ALGORITHM = 'sha256';

/**
 * 生成单据读取器本次账号范围的图片密钥。
 * @returns 仅保存在内存中的独立随机密钥。
 * @throws 系统随机源不可用时由 Node 抛出错误。
 */
export function createTicketImageKey(): Buffer {
  return randomBytes(IMAGE_KEY_BYTES);
}

/**
 * 为同一读取范围、账号、单据和原始地址生成稳定编号。
 * @param options 读取范围的密钥、已核实的身份、单据编号及钉钉给出的原始地址。
 * @returns 小写十六进制 HMAC；其中不包含可读取的账号、单据或地址字段。
 * @throws 密钥不是可用的缓冲区时由 Node 抛出错误。
 */
export function createTicketImageId(options: {
  key: Buffer;
  identity: Identity;
  ticketId: string;
  url: string;
}): string {
  const { key, identity, ticketId, url } = options;
  const { profile, corpId, userId } = identity;
  // 结构化编码保持字段边界，同一账号里的不同单据也不能交换图片编号。
  return createHmac(IMAGE_HMAC_ALGORITHM, key)
    .update(JSON.stringify([profile, corpId, userId, ticketId, url]))
    .digest('hex');
}
