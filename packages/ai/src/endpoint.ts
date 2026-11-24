// 将通过校验的 AI 基础地址拼接到固定接口，供探测和流式问答复用。

/**
 * 保留用户配置的路径和参数，生成同一来源的固定接口地址。
 * @param address 后台已校验的基础地址。
 * @param endpoint 模块选择的固定接口路径段。
 * @returns 供 HTTP 请求使用的 URL。
 * @throws 基础地址不是合法 URL 时抛错。
 */
export function getAiEndpointUrl(address: string, endpoint: string): URL {
  const url = new URL(address);
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/${endpoint}`;
  return url;
}
