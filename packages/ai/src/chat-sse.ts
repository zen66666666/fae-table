// 逐块还原有界 UTF-8 SSE 数据，供 AI 问答处理跨包文字和事件边界。
import { AppError } from '../../core/src/index.ts';
import { CHAT_EVENT_CHARS } from './constants.ts';

/** 模型端的一个 SSE 数据事件，不将原始响应作为页面内容。 */
export type AiChatFrame = { event: string; data: string };

/** 创建可安全分类的无效 SSE 事件错误，不带上游数据。 */
export function createChatFormatError(): AppError {
  return new AppError('protocol', 'invalid_ai_chat_stream', 'ai-chat');
}

/** 流式 SSE 帧读取器，限制单行和累计事件长度。 */
export class AiChatSseReader {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private suffix = '';
  private scanned = 0;
  private event = '';
  private parts: string[] = [];
  private dataLength = 0;

  /**
   * 输入下一个网络分片，输出已经完整的 SSE 事件。
   * @param bytes 本次收到的 UTF-8 字节。
   * @returns 可依次处理的完整事件。
   * @throws AppError 编码不正确或单行、事件过大。
   */
  push(bytes: Uint8Array): Iterable<AiChatFrame> {
    return this.consume(this.decode(bytes), false);
  }

  /**
   * 完成 UTF-8 解码，并处理最后一个可能没有空行的事件。
   * @returns 末尾可解析事件。
   * @throws AppError 流截断于未完整编码的字符或框架无效。
   */
  finish(): Iterable<AiChatFrame> {
    return this.consume(this.decode(), true);
  }

  private decode(bytes?: Uint8Array): string {
    try {
      return bytes ? this.decoder.decode(bytes, { stream: true }) : this.decoder.decode();
    } catch {
      throw createChatFormatError();
    }
  }

  private *consume(text: string, isFinal: boolean): Generator<AiChatFrame, void> {
    // 1. 扫描 CR、LF 或 CRLF。2. 保留不完整的行。3. 完成时提交最后一帧。
    const input = this.suffix + text;
    let start = 0;
    for (let index = this.scanned; index < input.length; index++) {
      const character = input[index];
      if (character !== '\r' && character !== '\n') continue;
      // 1. CRLF 可以被切在两个网络分片里，不能产生两次空行。
      if (character === '\r' && index === input.length - 1 && !isFinal) break;
      const frame = this.readLine(input.slice(start, index));
      if (character === '\r' && input[index + 1] === '\n') index++;
      start = index + 1;
      if (frame) yield frame;
    }
    this.suffix = input.slice(start); // 2.
    // 不重复扫描长行，只在下一块重查分片末尾尚未判定的 CR。
    this.scanned = this.suffix.length - Number(this.suffix.endsWith('\r'));
    if (this.suffix.length > CHAT_EVENT_CHARS) throw createChatFormatError();
    if (isFinal) {
      // 3. 有的兼容服务结束前没有最后一个空行，仍核对其中的结束标记。
      if (this.suffix) this.readLine(this.suffix);
      const frame = this.readLine('');
      this.suffix = '';
      this.scanned = 0;
      if (frame) yield frame;
    }
  }

  private readLine(line: string): AiChatFrame | undefined {
    if (line.length > CHAT_EVENT_CHARS) throw createChatFormatError();
    if (!line) {
      const frame = this.parts.length
        ? { event: this.event, data: this.parts.join('\n') }
        : undefined;
      this.event = '';
      this.parts = [];
      this.dataLength = 0;
      return frame;
    }
    const separator = line.indexOf(':');
    const name = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '');
    if (name === 'event') this.event = value;
    if (name === 'data') {
      this.dataLength += value.length + 1;
      if (this.dataLength > CHAT_EVENT_CHARS) throw createChatFormatError();
      this.parts.push(value);
    }
    return undefined;
  }
}
