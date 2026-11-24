// 展示未开始单据的常用问题，供 AI 助手填充输入框。
import type { ReactElement } from 'react';
import { AI_CHAT_COPY, AI_QUICK_QUESTIONS } from './ai-chat-copy.ts';
import { Button } from './button.tsx';

/** 只填入输入框的提问选择动作。 */
export type AiQuickQuestionsProps = { onChoose: (question: string) => void };

/**
 * 展示预设问题选项，不发起对话请求。
 * @param props 选中问题后的填入和聚焦入口。
 * @returns 指引和可选问题按钮。
 * @throws 无预期错误。
 */
export function AiQuickQuestions({ onChoose }: AiQuickQuestionsProps): ReactElement {
  return (
    <div className="ai-quick-questions">
      <p className="muted">{AI_CHAT_COPY.quickQuestions}</p>
      <div>
        {AI_QUICK_QUESTIONS.map((question) => (
          <Button size="small" key={question} onClick={() => onChoose(question)}>
            {question}
          </Button>
        ))}
      </div>
    </div>
  );
}
