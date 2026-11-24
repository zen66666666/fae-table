// 为列表、详情与写回确认生成相同的单据纯文本标题。
import type { TicketSummary } from './ticket-types.ts';

const HEADING_SEPARATOR = ' · ';

/** 缺少展示字段时沿用工作台统一占位符。 */
export const TICKET_TEXT_PLACEHOLDER = '—';

/**
 * 按发起人和模板生成可显示的标题，不将实例标识放进标题。
 * @param summary 单据的最少标题字段。
 * @returns 纯文本标题，两项都缺少时返回占位符。
 * @throws 无预期错误。
 */
export function getTicketHeading(
  summary: Pick<TicketSummary, 'id' | 'initiator' | 'templateName'>,
): string {
  const heading = [summary.initiator, summary.templateName]
    .map((value) => (summary.id ? value?.replaceAll(summary.id, '') : value)?.trim())
    .filter(Boolean)
    .join(HEADING_SEPARATOR);
  return heading || TICKET_TEXT_PLACEHOLDER;
}
