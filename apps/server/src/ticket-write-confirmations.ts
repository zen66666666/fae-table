// 管理两分钟有效的一次性写回确认，供单据写回服务使用。
import { createHash } from 'node:crypto';
import type { TicketWriteAction } from '../../../packages/core/src/index.ts';

const CONFIRMATION_LIFETIME_MS = 2 * 60_000;

/** 生成器使用 32 字节随机值的十六进制表示；路由用同一形状拒绝额外输入。 */
export const TICKET_CONFIRMATION_CODE = /^[a-f\d]{64}$/u;

type ConfirmedWrite = {
  account: string;
  id: string;
  taskId: string | null;
  action: TicketWriteAction;
  text: string;
  signal: AbortSignal;
};

type Grant = ConfirmedWrite & { code: string; digest: string; expiresAt: number };
type CodeRequest = Pick<Grant, 'code' | 'id' | 'account'>;
type UsedCode = Omit<CodeRequest, 'code'> & { expiresAt: number; signal: AbortSignal };

function getDigest(write: ConfirmedWrite): string {
  const { account, id, taskId, action, text } = write;
  return createHash('sha256')
    .update(JSON.stringify([account, id, taskId, action, text]))
    .digest('hex');
}

/** 每单只保存最新的确认；使用后立即消耗，任何写命令之前都必须经过这里。 */
export class TicketWriteConfirmations {
  private readonly now: () => number;
  private readonly createSecret: () => string;
  private readonly grants = new Map<string, Grant>();
  private readonly usedCodes = new Map<string, UsedCode>();

  /**
   * 使用后台已有的随机值和可替换时钟。
   * @param options 当前时钟及 32 字节随机码工厂。
   * @throws 无预期错误。
   */
  constructor(options: { now: () => number; createSecret: () => string }) {
    this.now = options.now;
    this.createSecret = options.createSecret;
  }

  /**
   * 新的准备请求开始时立即作废本单据先前的确认。
   * @param id 列表中经过校验的单据标识。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  revoke(id: string): void {
    this.grants.delete(id);
  }

  /**
   * 在任务核实后颁发确认码，替换本单之前准备的文字。
   * @param write 已经核对的账号、单据、当前任务、动作与规范文字。
   * @returns 仅供本次网页确认使用的随机码。
   * @throws 随机码工厂出错时抛出安全内部异常。
   */
  issue(write: ConfirmedWrite): string {
    const issuedAt = this.now();
    for (const [id, grant] of this.grants) {
      if (issuedAt >= grant.expiresAt || grant.signal.aborted) this.grants.delete(id);
    }
    for (const [code, used] of this.usedCodes) {
      if (used.signal.aborted || issuedAt >= used.expiresAt) this.usedCodes.delete(code);
    }
    const code = this.createSecret();
    if (!TICKET_CONFIRMATION_CODE.test(code)) throw new Error('invalid_confirmation_generator');
    this.grants.set(write.id, {
      ...write,
      code,
      digest: getDigest(write),
      expiresAt: issuedAt + CONFIRMATION_LIFETIME_MS,
    });
    return code;
  }

  /**
   * 核对身份和有效期后消耗确认码，执行端不能重试同一个码。
   * @param input 当前身份、单据和网页唯一传回的确认码。
   * @returns 已确认的固定操作，验证失败时为 undefined。
   * @throws 无预期错误。
   */
  take(input: CodeRequest): ConfirmedWrite | undefined {
    const { account, id, code } = input;
    const grant = this.grants.get(id);
    if (!grant || grant.code !== code || grant.account !== account) return undefined;
    this.grants.delete(id);
    if (grant.signal.aborted || this.now() >= grant.expiresAt || getDigest(grant) !== grant.digest)
      return undefined;
    // 浏览器可在连接断开时重发 POST。保留不含意见的短期标记，让网页区分已用和已过期。
    this.usedCodes.set(code, {
      account,
      id,
      signal: grant.signal,
      expiresAt: this.now() + CONFIRMATION_LIFETIME_MS,
    });
    return grant;
  }

  /**
   * 识别短期内同账号同单据对已用确认码的重放。
   * @param input 来自受保护执行路由的核实范围和确认码。
   * @returns 本实例已接收过有效确认时为 true。
   * @throws 无预期错误。
   */
  wasUsed(input: Pick<CodeRequest, 'code' | 'id'> & { account?: string }): boolean {
    const used = this.usedCodes.get(input.code);
    if (!used) return false;
    if (used.signal.aborted || this.now() >= used.expiresAt) {
      this.usedCodes.delete(input.code);
      return false;
    }
    // 单据完成后可能刚移出列表；此时仍用原范围信号检查同一实例的传输重放。
    return used.id === input.id && (input.account === undefined || used.account === input.account);
  }
}
