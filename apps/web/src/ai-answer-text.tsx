// 按纯文本段落和列表展示 AI 回答，允许加粗和经过核实的 PDF 页码链接。
import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { parseAiCitationParts, parseAiTextBlocks } from './ai-chat-text.ts';
import type { AiInlinePart } from './ai-chat-text.ts';
import { getTicketManualViewPath } from './api-client.ts';
import { ManualLink } from './manual-link.tsx';

const PDF_PAGE_FRAGMENT = '#page=';

/** 当前单据、回答纯文本与允许链接的本机 PDF 页数。 */
export type AiAnswerTextProps = { ticketId: string; answer: string; manualPageCount: number };

/**
 * 展示段落、列表和加粗文字。原始 HTML、Markdown 地址和未知页码不会生成可执行内容。
 * @param props 回答文字与后端核实的手册范围。
 * @returns 转义文本及应用构造的同源 PDF 跳转。
 * @throws 无预期错误。
 */
export function AiAnswerText({
  ticketId,
  answer,
  manualPageCount,
}: AiAnswerTextProps): ReactElement {
  const manualPath = getTicketManualViewPath(ticketId);
  function renderLine(parts: AiInlinePart[]): ReactNode {
    return parts.map(({ text, isBold }, index) => {
      const children = parseAiCitationParts({ text, manualPageCount }).map((part, partIndex) =>
        part.page ? (
          <ManualLink
            key={partIndex}
            href={`${manualPath}${PDF_PAGE_FRAGMENT}${part.page}`}
            label={part.text}
          />
        ) : (
          part.text
        ),
      );
      const Wrapper = isBold ? 'strong' : Fragment;
      return <Wrapper key={index}>{children}</Wrapper>;
    });
  }
  return (
    <div className="ai-answer-text">
      {parseAiTextBlocks(answer).map((block, index) => {
        if (block.kind === 'paragraph') {
          return (
            <p key={index}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={lineIndex}>
                  {lineIndex > 0 && '\n'}
                  {renderLine(line)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind === 'ordered' ? 'ol' : 'ul';
        return (
          <List key={index}>
            {block.lines.map((line, lineIndex) => (
              <li key={lineIndex}>{renderLine(line)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
