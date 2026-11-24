// 统一校验 AI 接口地址，后台请求和网页明文提示共用同一地址规则。

const MAX_ADDRESS_LENGTH = 2048;
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/u;

function isPrivateHttpHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  // URL 已把合法 IPv4 规范化，仍需严格匹配数字，防止把相似域名当成内网。
  if (!/^\d+\.\d+\.\d+\.\d+$/u.test(hostname)) return false;
  const [first, second] = hostname.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/**
 * 校验并解析 OpenAI 兼容接口的基础地址。
 * @param value 用户填写的基础地址，可以包含接口路径。
 * @returns 校验后的地址；格式、协议或明文主机不符合要求时返回 null。
 * @throws 不抛出错误。
 */
export function getAiAddress(value: string): URL | null {
  const source = value.trim();
  // 拒绝带认证信息的 URL 和易被解析为路径分隔符的反斜线。
  const authority = /^https?:\/\/([^/?#]+)/iu.exec(source)?.[1];
  if (
    !authority ||
    authority.includes('@') ||
    source.includes('\\') ||
    CONTROL_CHARACTER.test(value) ||
    source.length > MAX_ADDRESS_LENGTH
  )
    return null;
  try {
    const address = new URL(source);
    if (address.username || address.password) return null;
    address.hash = ''; // 片段只在浏览器使用，不属于服务地址。
    if (address.protocol === 'https:') return address;
    return address.protocol === 'http:' && isPrivateHttpHost(address.hostname) ? address : null;
  } catch {
    return null;
  }
}

/**
 * 比较两个有效接口地址的协议、主机和端口，用于判断可否沿用已保存的 Key。
 * @param address 本次填写的接口地址。
 * @param savedAddress 已保存的接口地址。
 * @returns 两个地址有效且规范化后的源相同时为 true。
 * @throws 不抛出错误。
 */
export function hasSameAiOrigin(address: string, savedAddress: string): boolean {
  const origin = getAiAddress(address)?.origin;
  // 使用 URL 规范化比较默认端口，路径和参数不改变接收 Key 的源。
  return origin !== undefined && origin === getAiAddress(savedAddress)?.origin;
}
