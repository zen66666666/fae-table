// 统一处理单据缺失的纯文本字段，由列表与详情展示复用。
import { TICKET_COPY } from './ticket-copy.ts';

/**
 * 保留接口返回的显示文本，缺失时显示占位符，不根据其他字段猜测。
 * @param value 已投影的单据纯文本或缺失值。
 * @returns 原文本或统一缺失占位符。
 * @throws 无预期错误。
 */
export function getTicketText(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? TICKET_COPY.placeholder : value;
}
