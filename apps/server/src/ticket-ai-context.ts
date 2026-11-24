// 为 AI 对话显式投影允许外发的单据、研发人员和手册文字，供单据对话服务使用。
import path from 'node:path';
import { getTicketProductModel, isTicketNoteField } from '../../../packages/core/src/index.ts';
import type {
  AiChatContext,
  TicketDetail,
  TicketPeopleResult,
} from '../../../packages/core/src/index.ts';

const PRIVATE_FIELD = /^(?:userid|profile|profilekey|profilehandle|apikey|ai key|本机文件路径)$/iu;
const PRIVATE_JSON_VALUE =
  /"(?:userId|profile|profileKey|profileHandle|apiKey)"\s*:\s*"(?:\\.|[^"\\\r\n])*"/giu;
const MEMBER_PLACEHOLDER = /^成员（[^）]{1,4}）$/u;
const QUESTION_FIELDS = /^(?:问题说明|问题描述|问题现象|故障描述)$/u;
const RETRIEVAL_DETAILS_LIMIT = 4_000;

const PATH_SEPARATOR = String.raw`[\\/]+`;
const PATH_SUFFIX = String.raw`[\\/]+[^\s"'()<>[\],;，。；）】]*`;
const PATH_END = String.raw`(?=$|[\s"'()<>[\],;，。；）】:])`;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^$\{\}()|[\]\\]/gu, '\\$&');
}

function getPrivatePathPatterns(directory: string): string[] {
  const absolute = directory.replace(/[\\/]+$/, '');
  const windows = path.win32.isAbsolute(absolute) && /^[a-z]:[\\/]/iu.test(absolute);
  if (windows) {
    const [drive, ...parts] = absolute.split(/[\\/]+/u);
    const disk = [escapePattern(drive), ...parts.map(escapePattern)].join(PATH_SEPARATOR);
    const url = parts.map((part) => escapePattern(encodeURIComponent(part))).join('/');
    return [String.raw`file:\/\/\/` + escapePattern(drive) + '/' + url, disk];
  }
  return path.posix.isAbsolute(absolute) ? [escapePattern(absolute)] : [];
}

/**
 * 构造本次外发的文字过滤器，只移除工作台实际使用的本机目录及其子路径。
 * @param directories 后台提供的可信运行、资料目录及可用别名。
 * @returns 清理明确受限内容的函数，保留客户写下的其他路径。
 * @throws 无预期错误。
 */
export function createChatTextFilter(
  directories: readonly (string | undefined)[],
): (value: string) => string {
  const roots = [...new Set(directories.filter(isName).flatMap(getPrivatePathPatterns))];
  if (!roots.length) return (value) => value.replace(PRIVATE_JSON_VALUE, '');
  const root = '(?:' + roots.join('|') + ')';
  // 先处理带引号的路径（子目录可能有空格），再处理普通文字中的路径。前后边界防止误删同名前缀。
  const quoted = new RegExp(String.raw`(["'])` + root + String.raw`(?:[\\/]+[^\r\n"']*)?\1`, 'giu');
  const unquoted = new RegExp(
    String.raw`(?<![\w.%-])` + root + '(?:' + PATH_SUFFIX + '|' + PATH_END + ')',
    'giu',
  );
  return (value) => value.replace(PRIVATE_JSON_VALUE, '').replace(quoted, '').replace(unquoted, '');
}

type TextFilter = (value: string) => string;

function getText(value: string | null, filter: TextFilter): string | null {
  return value === null ? null : filter(value);
}

function getName(value: string | null, filter: TextFilter): string | null {
  // 本机用标识末四位作为姓名占位，外发只接受实际展示姓名或“我”。
  return value && !MEMBER_PLACEHOLDER.test(value) ? getText(value, filter) : null;
}

function getPeople(result: TicketPeopleResult, filter: TextFilter): AiChatContext['researchers'] {
  const people = new Map<string, AiChatContext['researchers'][number]>();
  for (const match of result.matches) {
    for (const person of match.people) {
      const row = {
        name: filter(person.name),
        archivedAt: getText(person.archivedAt, filter),
        code: getText(person.code, filter),
      };
      people.set(JSON.stringify([row.name, row.archivedAt, row.code]), row);
    }
  }
  return [...people.values()];
}

function getTicketContext(detail: TicketDetail, filter: TextFilter): AiChatContext['ticket'] {
  const { summary, fields, attachments, records, tasks } = detail;
  return {
    templateName: getText(summary.templateName, filter),
    initiator: getName(summary.initiator, filter),
    status: getText(summary.status, filter),
    fields: fields
      .filter(
        (field) => !isTicketNoteField(field) && !PRIVATE_FIELD.test(field.label?.trim() ?? ''),
      )
      .map(({ label, text }) => ({ label: getText(label, filter), text: getText(text, filter) })),
    attachments: attachments.map(filter),
    records: records.map(({ actor, time, comment, imageCount, attachments }) => ({
      actor: getName(actor, filter),
      time: getText(time, filter),
      comment: getText(comment, filter),
      imageCount,
      attachments: attachments.map(filter),
    })),
    currentHandlers: [...new Set(tasks.map((task) => getName(task.actor, filter)).filter(isName))],
  };
}

function isName(value: string | null | undefined): value is string {
  return Boolean(value);
}

/**
 * 创建只含授权文本的请求资料，不传入单据、账号、附件或手册的原始对象。
 * @param options 本机详情、研发候选与找到的手册段落。
 * @returns 明确字段白名单后的请求资料。
 * @throws 无预期错误。
 */
export function createTicketAiContext(options: {
  detail: TicketDetail;
  people: TicketPeopleResult;
  manual: AiChatContext['manual'];
  filter: TextFilter;
}): AiChatContext {
  const { detail, people, manual, filter } = options;
  return {
    ticket: getTicketContext(detail, filter),
    researchers: getPeople(people, filter),
    manual: manual && {
      pageCount: manual.pageCount,
      passages: manual.passages.map(({ fileName, page, text }) => ({
        fileName: filter(fileName),
        page,
        text: filter(text),
      })),
    },
  };
}

/**
 * 组合问题和已读表单中的型号、问题说明，供本机手册检索使用。
 * @param question 用户当前的提问。
 * @param detail 当前单据已读详情。
 * @returns 有限关键词输入，不发送给任何检索服务。
 * @throws 无预期错误。
 */
export function createTicketAiSearch(question: string, detail: TicketDetail): string {
  const problem = detail.fields.find(
    (field) => !isTicketNoteField(field) && QUESTION_FIELDS.test(field.label?.trim() ?? ''),
  )?.text;
  return [
    question,
    getTicketProductModel(detail.fields),
    problem?.slice(0, RETRIEVAL_DETAILS_LIMIT),
  ]
    .filter(Boolean)
    .join('\n');
}
