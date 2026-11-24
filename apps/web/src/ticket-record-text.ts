// 将已投影的沟通记录组合为纯文本，由系统行与评论气泡复用，不解释客户内容。
import type { TicketRecord } from '../../../packages/core/src/index.ts';
import { TICKET_COPY } from './ticket-copy.ts';
import {
  TICKET_ACTION_LABELS,
  TICKET_RECORD_COPY,
  TICKET_RESULT_LABELS,
} from './ticket-record-copy.ts';
import { getTicketText } from './ticket-value.ts';

const EMPTY_RECORD_VALUE = /^NONE(?:\s*[:：]\s*\d+)?$/iu;
const AGREEMENT_ACTION = 'AGREE';
const NORMAL_TASK_ACTION = 'EXECUTE_TASK_NORMAL';

function readRecordValue(value: string | null): string | null {
  // 钉钉有时给空结果附上计数，只过滤动作或结果字段里的完整占位值，保留用户意见原文。
  const normalized = value?.trim();
  return normalized && !EMPTY_RECORD_VALUE.test(normalized) ? normalized : null;
}

function readRecordLabel(
  code: string | null,
  labels: Readonly<Record<string, string>>,
): string | null {
  // 未知代码必须原样显示，不能把对象原型上的同名属性当成动作译名。
  return code && Object.hasOwn(labels, code) ? labels[code] : null;
}

function formatApprovalRecord(options: { comment: string | null; node: string | null }): string {
  const { comment, node } = options;
  const agreement = TICKET_RESULT_LABELS.AGREE;
  const hasNodeName = node && node !== agreement && node !== TICKET_RECORD_COPY.passed;
  const action = hasNodeName
    ? TICKET_RECORD_COPY.formatPassedStep(node)
    : TICKET_RECORD_COPY.passed;
  const opinion = comment?.trim();
  const duplicates = [agreement, AGREEMENT_ACTION, TICKET_RECORD_COPY.passed, action];
  // 自动填入的同意意见与动作相同，没有必要重复；不同意见仍按原文呈现。
  return opinion && !duplicates.includes(opinion) ? `${action}：${comment}` : action;
}

/**
 * 使用钉钉动作名称或已明确的中文译名，保留未知动作和结果代码。
 * @param record 后台投影的系统记录；动作名称不能当作人员姓名。
 * @returns 包含处理人、动作、明确人数、结果和意见的纯文本。
 * @throws 无预期错误。
 */
export function formatTicketSystemRecord(record: TicketRecord): string {
  const actor = record.isMine ? TICKET_COPY.mine : getTicketText(record.actor);
  const resultValue = readRecordValue(record.result);
  if (
    record.action === AGREEMENT_ACTION ||
    (record.action === NORMAL_TASK_ACTION && resultValue === AGREEMENT_ACTION)
  ) {
    return `${actor} ${formatApprovalRecord({ comment: record.comment, node: readRecordValue(record.actionName) })}`;
  }
  const knownResult = readRecordLabel(resultValue, TICKET_RESULT_LABELS);
  const result = knownResult || resultValue;
  // 普通任务动作本身不能代表同意或拒绝，只有明确的处理结果才能替换动作译名。
  const taskOutcome = record.action === NORMAL_TASK_ACTION && knownResult;
  const action =
    readRecordValue(record.actionName) ||
    taskOutcome ||
    readRecordLabel(record.action, TICKET_ACTION_LABELS) ||
    getTicketText(readRecordValue(record.action));
  // CLI 也会给其他动作返回空的抄送集合，人数只能附在明确的抄送动作后。
  const isCarbonCopy = record.action === 'CC' || record.action === 'PROCESS_CC';
  const recipients =
    !isCarbonCopy || record.recipientCount === null
      ? ''
      : ` ${record.recipientCount}${TICKET_RECORD_COPY.recipientsSuffix}`;
  const outcome = result && result !== action ? ` · ${result}` : '';
  const opinion = record.comment?.trim();
  const comment = opinion && opinion !== result && opinion !== action ? `：${record.comment}` : '';
  return `${actor} ${action}${recipients}${outcome}${comment}`;
}
