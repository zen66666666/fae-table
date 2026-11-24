// 托管 Vite 构建产物，只允许读取指定网页目录中的普通文件。
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { INDEX_PATH, MIME_TYPES } from './constants.ts';
import { sendFailure } from './http-response.ts';
import type { ServerFileSystem } from './types.ts';

/**
 * 返回网页静态文件，校验解析后的真实路径以阻止路径穿越和链接越界。
 * @param options URL 路径、构建目录、文件系统与 HTTP 响应。
 * @returns 无返回值。
 * @throws 不抛出预期读取错误；缺失或越界均返回安全的 HTTP 错误。
 */
export function serveStaticFile(options: {
  pathname: string;
  webDirectory: string;
  fileSystem: ServerFileSystem;
  response: ServerResponse;
}): void {
  try {
    const name = options.pathname === '/' ? INDEX_PATH : decodeURIComponent(options.pathname);
    if (name.includes('\0') || name.includes('\\')) throw new Error('Invalid asset path');
    const root = options.fileSystem.realpathSync(options.webDirectory);
    const file = options.fileSystem.realpathSync(path.resolve(root, `.${name}`));
    const relative = path.relative(root, file);
    // 使用真实路径，防止构建目录内的符号链接逃出静态文件边界。
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !options.fileSystem.statSync(file).isFile()
    ) {
      throw new Error('Invalid asset path');
    }
    const contentType = MIME_TYPES[path.extname(file).toLowerCase()];
    if (!contentType) throw new Error('Unsupported asset');
    options.response.setHeader('Content-Type', contentType);
    options.response.end(options.fileSystem.readFileSync(file));
  } catch {
    sendFailure({ response: options.response, status: 404, reason: 'configuration' });
  }
}
