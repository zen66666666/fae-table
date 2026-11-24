// 按完整 UTF-8 行解析事件正文及订阅就绪提示，只保留计数和清理所需标识。
import { StringDecoder } from 'node:string_decoder';
import { isObject } from '../../core/src/index.ts';
import { createEmptyCounts } from './event-types.ts';
import type { EventKey } from './event-types.ts';

/** 事件行解析器；订阅标识仅留在内存，公开字段沿用既有调用契约。 */
export class EventParser {
  ready = false;
  malformed = false;
  counts = createEmptyCounts();
  subscriptionIds = new Set<string>();
  stdoutBuffer = '';
  stderrBuffer = '';
  stdoutDecoder = new StringDecoder('utf8');
  stderrDecoder = new StringDecoder('utf8');
  eventKeys: Set<string>;
  onReady: () => void;

  /**
   * 建立解析器。
   * @param eventKeys 允许接收的事件名称。
   * @param onReady 首次收到完整就绪行时调用；其异常由调用方处理。
   */
  constructor(eventKeys: readonly string[], onReady: () => void = () => {}) {
    this.eventKeys = new Set(eventKeys);
    this.onReady = onReady;
  }

  /**
   * 接收标准输出字节块并解析完整行。
   * @param chunk 可能跨越字符或行边界的 UTF-8 字节。
   * @returns 无返回值；无效事件只设置 malformed。
   */
  pushStdout(chunk: Buffer): void {
    this.stdoutBuffer += this.stdoutDecoder.write(chunk);
    this.flushLines('stdout');
  }

  /**
   * 接收标准错误字节块并解析完整行。
   * @param chunk 可能跨越字符或行边界的 UTF-8 字节。
   * @returns 无返回值；就绪回调的异常会向上传播。
   */
  pushStderr(chunk: Buffer): void {
    this.stderrBuffer += this.stderrDecoder.write(chunk);
    this.flushLines('stderr');
  }

  /**
   * 解析指定流已收齐的行，保留最后一个未完成片段。
   * @param stream 要处理的输出流。
   * @returns 无返回值；就绪回调的异常会向上传播。
   */
  flushLines(stream: 'stdout' | 'stderr'): void {
    const property = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const lines = this[property].split('\n');
    this[property] = lines.pop()!;
    for (const line of lines) this.line(stream, line.replace(/\r$/, ''));
  }

  /**
   * 解析单个完整行，方法名保留既有调用契约。
   * @param stream 行所属的输出流。
   * @param line 不含行分隔符的文本。
   * @returns 无返回值；就绪回调的异常会向上传播。
   */
  line(stream: 'stdout' | 'stderr', line: string): void {
    if (!line.trim()) return;
    if (stream === 'stdout') {
      this.parseEvent(line);
      return;
    }
    const subscription =
      /^\[event\] (?:subscription|ready)\b.*\bevent_key=(\S+).*\bsubscribe_id=(\S+)/.exec(line);
    if (subscription && this.eventKeys.has(subscription[1]))
      this.subscriptionIds.add(subscription[2]);
    const multiReady = /^\[event\] ready event_count=(\d+)\b/.exec(line);
    const singleReady = /^\[event\] ready event_key=(\S+)\b/.exec(line);
    if (
      !this.ready &&
      ((multiReady && Number(multiReady[1]) === this.eventKeys.size) ||
        (singleReady && this.eventKeys.size === 1 && this.eventKeys.has(singleReady[1])))
    ) {
      this.ready = true;
      this.onReady();
    }
  }

  private parseEvent(line: string): void {
    try {
      const event: unknown = JSON.parse(line);
      if (!isObject(event) || typeof event.type !== 'string' || !this.eventKeys.has(event.type)) {
        this.malformed = true;
        return;
      }
      this.counts[event.type as EventKey]++;
    } catch {
      this.malformed = true;
    }
  }

  /**
   * 结束解码并处理没有换行符的最后一个片段。
   * @returns 无返回值；就绪回调的异常会向上传播。
   */
  finish(): void {
    this.stdoutBuffer += this.stdoutDecoder.end();
    this.stderrBuffer += this.stderrDecoder.end();
    if (this.stdoutBuffer) this.line('stdout', this.stdoutBuffer);
    if (this.stderrBuffer) this.line('stderr', this.stderrBuffer);
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }
}
