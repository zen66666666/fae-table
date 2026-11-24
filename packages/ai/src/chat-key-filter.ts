// 在 SSE 文本分片之间遮蔽当前 API Key，供流式答复交付前使用。
import { CHAT_REDACTED_KEY } from './constants.ts';

function getPrefixLengths(value: string): number[] {
  const lengths = new Array<number>(value.length).fill(0);
  for (let index = 1; index < value.length; index++) {
    let size = lengths[index - 1];
    while (size > 0 && value[size] !== value[index]) size = lengths[size - 1];
    if (value[size] === value[index]) size++;
    lengths[index] = size;
  }
  return lengths;
}

/** 只保留可能属于凭据的末尾前缀，防止把跨分片的完整凭据发回网页。 */
export class AiChatKeyFilter {
  private readonly key: string;
  private readonly prefixes: number[];
  private matched = 0;

  /**
   * 创建针对当前实际 Key 的流式遮蔽器，不输出或记录凭据。
   * @param key 后台已校验、非空的授权凭据。
   * @throws 无预期错误。
   */
  constructor(key: string) {
    this.key = key;
    this.prefixes = getPrefixLengths(key);
  }

  /**
   * 处理模型的下一段文字，输出可安全转发的部分。
   * @param text SSE 中解析出的单纯文本内容。
   * @returns 已遮蔽 Key、且尚未判定的尾部暂不输出的文字。
   * @throws 无预期错误。
   */
  push(text: string): string {
    const input = this.key.slice(0, this.matched) + text;
    const parts: string[] = [];
    let start = 0;
    // 保留跨块的匹配状态，让任意重复字符及长 Key 也只需要线性扫描。
    for (let index = this.matched; index < input.length; index++) {
      const character = input[index];
      while (this.matched > 0 && character !== this.key[this.matched]) {
        this.matched = this.prefixes[this.matched - 1];
      }
      if (character === this.key[this.matched]) this.matched++;
      if (this.matched === this.key.length) {
        parts.push(input.slice(start, index + 1 - this.key.length), CHAT_REDACTED_KEY);
        start = index + 1;
        this.matched = 0;
      }
    }
    parts.push(input.slice(start, input.length - this.matched));
    return parts.join('');
  }

  /**
   * 正常结束时输出已确定不会成为完整凭据的末尾文字。
   * @returns 最后保留的文字；非正常结束由调用方丢弃它。
   * @throws 无预期错误。
   */
  finish(): string {
    return this.key.slice(0, this.matched);
  }
}
