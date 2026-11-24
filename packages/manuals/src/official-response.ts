// 约束官网出站请求的凭据及重定向，供搜索 HTML 和 PDF 下载复用。

/** 手工处理重定向并禁用会话凭据，防止资料请求跨站或带上用户数据。 */
export const MANUAL_REQUEST_POLICY = {
  method: 'GET',
  redirect: 'manual',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
} as const;

/**
 * 核对 HTTP 响应真正来自本次生成的固定 HTTPS 地址。
 * @param response 官网返回或注入的响应。
 * @param url 发起请求时已构造的固定地址。
 * @returns 成功、未被重定向且来源和路径一致时为 true。
 * @throws 无预期错误。
 */
export function isManualOfficialResponse(response: Response, url: URL): boolean {
  // 测试注入的 Response 无 URL；生产 fetch 的 URL 必须与请求完全一致。
  return response.ok && !response.redirected && (!response.url || response.url === url.href);
}
