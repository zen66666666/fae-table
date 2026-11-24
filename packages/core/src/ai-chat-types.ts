// 定义本机单据 AI 对话的限额、流事件和允许外发的资料结构，供后台与网页共用。

/** 最近列表中单据的 AI 对话路由末段。 */
export const AI_CHAT_SEGMENT = 'ai-chat';
/** 清空当前单据 AI 记录的固定子路由。 */
export const AI_CHAT_CLEAR_SEGMENT = 'clear';
/** 停止当前单据指定回答的固定子路由。 */
export const AI_CHAT_STOP_SEGMENT = 'stop';
/** 读取本机当前账号的问答进行状态，不读取历史或连接上游。 */
export const AI_ACTIVE_ROUTE = '/api/ai/active';
/** 网页刷新后台回答进度的周期，单位毫秒。 */
export const AI_CHAT_ACTIVE_POLL_INTERVAL_MS = 1_000;
/** 用户问题的字符上限，允许安全放进有界 JSON 请求。 */
export const AI_CHAT_QUESTION_LIMIT = 2_000;
/** 每张单据保留的最近完整或明确截断问答数量。 */
export const AI_CHAT_HISTORY_LIMIT = 10;

/** 发送前投影的单据、研发候选和手册段落，禁止附带身份或路径。 */
export type AiChatContext = {
  ticket: {
    templateName: string | null;
    initiator: string | null;
    status: string | null;
    fields: { label: string | null; text: string | null }[];
    attachments: string[];
    records: {
      actor: string | null;
      time: string | null;
      comment: string | null;
      imageCount: number;
      attachments: string[];
    }[];
    currentHandlers: string[];
  };
  researchers: { name: string; archivedAt: string | null; code: string | null }[];
  manual: {
    pageCount: number;
    passages: { fileName: string; page: number; text: string }[];
  } | null;
};

/** 实际删掉的沟通记录、手册段落、问答轮数及极端长度下被删掉的字段、人员、附件和截短标志。 */
export type AiChatTrim = {
  records: number;
  manualPassages: number;
  historyTurns: number;
  fields?: number;
  researchers?: number;
  attachments?: number;
  handlers?: number;
  isOtherContentTrimmed: boolean;
};

/** 实际发送内容的概要；每段对应一个页码，网页不接收原始请求结构。 */
export type AiChatSummary = {
  fieldCount: number;
  recordCount: number;
  researcherCount: number;
  manualPages: number[];
  manualPageCount: number | null;
  isManualWithoutText?: true;
  trimmed?: AiChatTrim;
};

/** 单次回答的安全结果；上游错误正文不进入流事件。 */
export type AiChatOutcome = {
  kind:
    | 'complete'
    | 'truncated'
    | 'timeout'
    | 'invalid-key'
    | 'rate-limited'
    | 'service-error'
    | 'unreachable'
    | 'stopped'
    | 'detail-unavailable';
};

/** 可继续用于同一单据上下文的问答及其引用范围。 */
export type AiChatTurn = {
  id: string;
  question: string;
  answer: string;
  /** 本轮实际使用的模型；旧版保留的问答可能没有该字段。 */
  model?: string;
  summary: AiChatSummary;
  outcome: 'complete' | 'truncated';
};

/** 本机运行中的回答摘要，可在切换单据或页面刷新后重新读取。 */
export type AiChatActive = {
  runId: string;
  question: string;
  answer: string;
  startedAt: number;
  model?: string;
  summary?: AiChatSummary;
};

/** 网页恢复某张单据时取得的历史和运行中的回答。 */
export type AiChatHistory = { turns: AiChatTurn[]; isSaveFailed?: true; active?: AiChatActive };

/** 左栏标记与模型互斥检查共用的本机问答状态。 */
export type AiChatActiveStatus = { ticketIds: string[]; isAnswering: boolean };

/** 停止针对指定回答，过期的回答标识不会影响当前新回答。 */
export type AiChatStopResult = { kind: 'stopped' | 'not-running' };

/** 一个服务端发送事件，按概要、回答增量和最终结果传输。 */
export type AiChatEvent =
  | { kind: 'started'; runId: string; startedAt: number }
  | { kind: 'context'; summary: AiChatSummary; model?: string }
  | { kind: 'delta'; text: string }
  | { kind: 'done'; outcome: AiChatOutcome; turnId?: string; isSaveFailed?: true; model?: string };
