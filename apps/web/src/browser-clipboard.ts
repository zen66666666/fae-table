// 封装浏览器剪贴板，由审批编号和 AI 回答的复制按钮共用。

/**
 * 把明示选中的纯文本写入本机剪贴板。
 * @param text 用户要求复制的内容。
 * @returns 剪贴板写入完成的 Promise。
 * @throws 浏览器或用户没有授权写剪贴板时拒绝。
 */
export async function writeBrowserClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
