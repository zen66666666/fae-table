// 提取可公开的命令行版本号，供钉钉连接状态使用。
const VERSION_PATTERN = /\bv?(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/i;

/**
 * 从 CLI 返回中只投影版本号，避免把诊断正文传给网页。
 * @param output CLI 的版本输出。
 * @returns 首个合法版本号，无法识别时为 null。
 * @throws 不抛出错误。
 */
export function parseCliVersion(output: string): string | null {
  return VERSION_PATTERN.exec(output)?.[1] ?? null;
}
