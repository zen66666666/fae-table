// 保存一轮后台回答的有界快照，供本机历史和已连接的事件订阅者使用。
import type { AiChatActive, AiChatEvent } from '../../../packages/core/src/index.ts';

/** 订阅者只接收本机流事件，断开订阅不会停止回答。 */
export type TicketAiListener = (event: AiChatEvent) => void;

/** 一轮独立回答和停止信号；生成内容及其读者均只在内存中保留。 */
export class TicketAiRun {
  /** 只有后台停止、账号失效或退出时才取消本轮信号。 */
  readonly controller = new AbortController();
  private state: AiChatActive;
  private readonly listeners = new Set<TicketAiListener>();

  /**
   * 在后台接收合法问题后创建空回答。
   * @param input 本机生成的运行标识、问题和开始时间。
   * @throws 无预期错误。
   */
  constructor(input: Pick<AiChatActive, 'runId' | 'question' | 'startedAt'>) {
    this.state = { ...input, answer: '' };
  }

  /** 当前供同账号单据恢复的安全快照。 */
  get snapshot(): AiChatActive {
    return this.state;
  }

  /**
   * 用最终经过现有材料过滤的提问更新内存快照。
   * @param question 已过滤或截短的本轮问题。
   * @returns 无返回值。
   * @throws 无预期错误。
   */
  updateQuestion(question: string): void {
    this.state = { ...this.state, question };
  }

  /**
   * 订阅本轮的后续事件，不修改问答生命周期。
   * @param listener 对当前浏览器连接写入事件的回调。
   * @returns 关闭连接时使用的退订函数。
   * @throws 无预期错误。
   */
  subscribe(listener: TicketAiListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 1. 更新可恢复快照。2. 将新事件转发给仍连接的浏览器。
   * @param event 生成逻辑已经过滤的材料、文字或结束事件。
   * @returns 无返回值；一轮结束后释放订阅。
   * @throws 订阅异常只移除该订阅，不影响后台回答和保存。
   */
  publish(event: AiChatEvent): void {
    // 1. 只保存已受上游字数限制的增量，不额外保留所有流事件。
    if (event.kind === 'context')
      this.state = { ...this.state, summary: event.summary, model: event.model };
    if (event.kind === 'thinking')
      this.state = { ...this.state, thinkingStartedAt: event.startedAt };
    if (event.kind === 'delta')
      this.state = {
        ...this.state,
        answer: this.state.answer + event.text,
        thinkingStartedAt: undefined,
      };
    for (const listener of this.listeners) {
      try {
        listener(event); // 2.
      } catch {
        this.listeners.delete(listener);
      }
    }
    if (event.kind === 'done') this.listeners.clear();
  }
}
