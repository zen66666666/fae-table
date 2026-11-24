// 保存当前已验证账号的单据草稿，供单据服务在内存中读写。
import type { TicketDraft } from '../../../packages/core/src/index.ts';

/** 绑定当前单据和身份版本的草稿存取句柄；失效时返回 undefined。 */
export type TicketDraftAccess = {
  read: () => TicketDraft | undefined;
  save: (draft: TicketDraft) => TicketDraft | undefined;
};

/** 本实例当前账号的草稿缓存；不写文件、不记录日志。 */
export class TicketDraftCache {
  private scope?: string;
  private texts = new Map<string, string>();

  /**
   * 更新已确认的账号范围；不同账号不能共享之前的草稿。
   * @param scope 仅用于内部比较的账号标识。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  setScope(scope: string): void {
    if (this.scope !== scope) this.clear();
    this.scope = scope;
  }

  /**
   * 清除上一个登录范围的所有草稿，供身份切换和关闭使用。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  clear(): void {
    this.scope = undefined;
    this.texts.clear();
  }

  /**
   * 为一个已经校验过的单据创建草稿访问句柄。
   * @param options 单据标识及用于复核当前身份和列表成员资格的函数。
   * @returns 内存读写句柄；空文本删除草稿，权限失效时不读写缓存。
   * @throws 无预期错误。
   */
  createAccess(options: { id: string; canAccess: () => boolean }): TicketDraftAccess {
    const { id, canAccess } = options;
    return {
      read: () => (canAccess() ? { text: this.texts.get(id) ?? '' } : undefined),
      save: ({ text }) => {
        // PUT 读取正文可能跨越账号切换；只有提交时仍具有原访问范围才写入。
        if (!canAccess()) return undefined;
        if (text === '') this.texts.delete(id);
        else this.texts.set(id, text);
        return { text };
      },
    };
  }
}
