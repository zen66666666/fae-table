// 通过系统 PowerShell 调用当前用户 DPAPI，供 AI 凭据和本机问答存储加解密。
import { AppError, runPowerShell } from '../../core/src/index.ts';
import type { PowerShellOptions } from '../../core/src/index.ts';
import { DPAPI_MAX_ENCODED_BYTES, DPAPI_OUTPUT_BYTES, DPAPI_TIMEOUT_MS } from './constants.ts';

const DPAPI_SCRIPTS = {
  protect: createDpapiScript('Protect'),
  unprotect: createDpapiScript('Unprotect'),
} as const;
const BASE64_DATA = /^[A-Za-z\d+/]+={0,2}$/u;

/** DPAPI 的系统定位、进程、取消信号和 Base64 输入输出上限，上限默认适用于 Key。 */
export type DpapiOptions = Pick<PowerShellOptions, 'environment' | 'signal' | 'spawn' | 'run'> & {
  maxEncodedBytes?: number;
};

/** 本机文本加解密操作，输入或系统进程无效时抛出固定的安全错误。 */
export type DpapiProtection = {
  protect: (text: string) => Promise<string>;
  unprotect: (encrypted: string) => Promise<string>;
};

function createDpapiScript(operation: 'Protect' | 'Unprotect'): string {
  // 由固定操作生成脚本；标准输入承载编码数据，避免将敏感信息放进脚本、命令行或环境。
  return [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    '  Add-Type -AssemblyName System.Security',
    '  $inputBytes = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
    `  $outputBytes = [Security.Cryptography.ProtectedData]::${operation}($inputBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '  [Console]::Out.Write([Convert]::ToBase64String($outputBytes))',
    '} catch {',
    '  exit 1',
    '}',
  ].join('\n');
}

async function invokeDpapi(
  options: DpapiOptions & {
    operation: keyof typeof DPAPI_SCRIPTS;
    encodedInput: string;
  },
): Promise<string> {
  // 1. 将已有编码数据经标准输入传给固定脚本。2. 只接收通过检查的编码输出。
  const {
    operation,
    encodedInput,
    maxEncodedBytes = DPAPI_OUTPUT_BYTES,
    ...dependencies
  } = options;
  const error = new AppError('configuration', 'ai_credential_unavailable', 'ai-credential');
  if (encodedInput.length > maxEncodedBytes || !BASE64_DATA.test(encodedInput)) throw error;
  try {
    const result = await runPowerShell({
      // 1.
      ...dependencies,
      script: DPAPI_SCRIPTS[operation],
      stdin: encodedInput,
      timeoutMs: DPAPI_TIMEOUT_MS,
      maxOutputBytes: maxEncodedBytes,
    });
    const output = result.stdout.trim();
    // 2. 原始系统错误可能含管道信息，始终改为固定错误类别。
    if (
      result.failure ||
      result.exitCode !== 0 ||
      output.length > maxEncodedBytes ||
      !BASE64_DATA.test(output)
    )
      throw error;
    return output;
  } catch {
    throw error;
  }
}

/**
 * 创建绑定当前 Windows 用户的本机文本加解密函数。
 * @param options 可替换的进程依赖、取消信号和 Base64 输入输出上限。
 * @returns 成对的保护与解密操作；明文仅供服务内部使用。
 * @throws 资源上限非法，或加解密时 DPAPI 和系统进程不可用，抛出安全配置错误。
 */
export function createDpapiProtection(options: DpapiOptions = {}): DpapiProtection {
  const { maxEncodedBytes = DPAPI_OUTPUT_BYTES } = options;
  if (
    !Number.isSafeInteger(maxEncodedBytes) ||
    maxEncodedBytes <= 0 ||
    maxEncodedBytes > DPAPI_MAX_ENCODED_BYTES
  )
    throw new AppError('configuration', 'ai_credential_unavailable', 'ai-credential');
  return {
    protect: async (text) =>
      await invokeDpapi({
        ...options,
        operation: 'protect',
        encodedInput: Buffer.from(text, 'utf8').toString('base64'),
      }),
    unprotect: async (encrypted) => {
      const encoded = await invokeDpapi({
        ...options,
        operation: 'unprotect',
        encodedInput: encrypted,
      });
      return Buffer.from(encoded, 'base64').toString('utf8');
    },
  };
}
