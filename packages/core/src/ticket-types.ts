// 定义单据展示和本机回复草稿的共用契约，供后台与网页使用。

/** 钉钉单据实例标识的白名单格式，禁止路径和命令参数。 */
export const TICKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;
import type { ConnectionReason } from './connection-types.ts';

/** 单据草稿路由使用的固定末段。 */
export const TICKET_DRAFT_SEGMENT = 'draft';
/** 单张单据刷新路由使用的固定末段。 */
export const TICKET_UPDATE_SEGMENT = 'refresh';
/** 记录图片的受保护接口路径段。 */
export const TICKET_IMAGES_SEGMENT = 'images';
/** 草稿字符上限（UTF-16 代码单元）；即使 JSON 全部使用转义也小于请求体限额。 */
export const TICKET_DRAFT_MAX_LENGTH = 2500;
/** 当前单据的本机内存草稿，空文本表示没有草稿。 */
export type TicketDraft = { text: string };

/** 单据来源；同一实例可以同时出现在多个来源中。 */
export type TicketSource = 'pending' | 'cc' | 'executed';
/** 单据读取完整性；成功允许为空，部分读取与失败不能作为空列表处理。 */
export type TicketReadKind = 'success' | 'partial' | 'failure';
/** 单据读取的安全原因，不包含原始异常正文或客户内容。 */
export type TicketReason =
  | ConnectionReason
  | 'connection-required'
  | 'page-limit'
  | 'not-found'
  | 'command-start'
  | 'output-limit'
  | 'aborted'
  | 'exit-error'
  | 'invalid-response';

/** 单据详情读取失败的固定环节及安全原因，供预读调度与结果快照使用。 */
export type TicketDetailFailure = { part: 'detail' | 'records' | 'tasks'; reason: TicketReason };

/** 当前可核实的流程步骤及处理状态，只包含可公开的固定节点名称。 */
export type TicketProgress = {
  steps: readonly { name: string; shortName: string }[];
  /** 当前节点在步骤数组里的零基下标。 */
  currentIndex: number;
  state: 'waiting-for-me' | 'transferred-to-me' | 'waiting-for-others';
};

/** 两种受支持的技术支持流程名称，供读取范围和界面短名称共用。 */
export const TICKET_TEMPLATES = {
  fast: '快速技术支持流程',
  service: '客服技术支持流程',
} as const;

/** 单据展示摘要；接口未返回的内容为 null，不能从标题或来源推测处理人。 */
export type TicketSummary = {
  id: string;
  title: string | null;
  templateName: string | null;
  initiator: string | null;
  createdAt: string | null;
  status: string | null;
  sources: TicketSource[];
  isCurrentActor: boolean | null;
  /** 是否已核实最新一条评论来自当前用户，尚未读取详情为 null。 */
  hasReplied: boolean | null;
  /** 是否已核实确认收到问题的步骤通过且尚未退回；列表初读时可省略。 */
  hasConfirmedReceipt?: boolean;
  /** 是否已核实我同意方案后正在等待他人；列表初读时可省略。 */
  isAwaitingOthers?: boolean;
  /** 详情是否已核实有他人转交给当前用户；列表初读时可省略。 */
  isTransferredToMe?: boolean;
  /** 当前流程进度；原始证据不足或流程结束时省略。 */
  progress?: TicketProgress;
};
/** 单一来源的读取进度，仅包含页数、完整性与原因。 */
export type TicketSourceResult = {
  source: TicketSource;
  kind: TicketReadKind;
  reason: TicketReason;
  pages: number;
};
/** 列表接口返回；items 为空时仍须先检查 kind 和 reason。 */
export type TicketListResult = {
  kind: TicketReadKind;
  reason: TicketReason;
  items: TicketSummary[];
  sources: TicketSourceResult[];
};
/** 表单字段只包含标签、已投影的显示文本和组件类型；未知结构不交给网页解释。 */
export type TicketField = { label: string | null; text: string | null; type: string | null };

const NOTE_FIELD_TYPE = 'TextNote';

/**
 * 识别钉钉在表单中附带的说明文字，详情展示和 AI 资料均使用同一排除规则。
 * @param field 已投影的表单字段。
 * @returns 字段为隐藏说明时为 true。
 * @throws 无预期错误。
 */
export function isTicketNoteField(field: TicketField): boolean {
  return field.type === NOTE_FIELD_TYPE;
}
/** 沟通记录的安全投影；只提供文字、附件名称和图片数量，不携带人员标识或媒体地址。 */
export type TicketRecord = {
  actor: string | null;
  action: string | null;
  /** 钉钉返回的动作或节点名称，不能用作人员姓名。 */
  actionName: string | null;
  result: string | null;
  time: string | null;
  comment: string | null;
  /** 评论与系统动作分开展示，同意或拒绝时的意见仍属于系统动作。 */
  kind: 'comment' | 'system';
  /** 只按模块内已核实的当前用户标识判断。 */
  isMine: boolean;
  /** images 中有效图片项的数量，不含空占位；图片内容与地址不会进入网页。 */
  imageCount: number;
  /** 当前账号读取范围内稳定的图片编号；读取时仍要核对最新详情和列表资格。 */
  imageIds?: string[];
  /** 当前记录及已归并附件容器的文件名。 */
  attachments: string[];
  /** 接口明确返回接收人集合时的去重人数，缺少集合时为 null。 */
  recipientCount: number | null;
};
/** 当前任务的纯文本投影；isMine 只按已核实的当前 userId 比较。 */
export type TicketTask = { actor: string | null; status: string | null; isMine: boolean };
/** 完整详情的展示结构；附件仅包含名称，没有链接或下载参数。 */
export type TicketDetail = {
  summary: TicketSummary;
  /** 钉钉展示的审批编号；空白或未提供时为 null。 */
  businessId: string | null;
  fields: TicketField[];
  attachments: string[];
  records: TicketRecord[];
  tasks: TicketTask[];
};
/** 详情接口返回；详情主体读取失败时 detail 为 null，辅助信息缺失时可为部分读取。 */
export type TicketDetailResult = {
  kind: TicketReadKind;
  reason: TicketReason;
  detail: TicketDetail | null;
  failures?: TicketDetailFailure[];
};

/** 左栏按业务优先级排列的五个分组。 */
export type TicketGroup = 'pending' | 'transferred' | 'unreplied' | 'replied' | 'finished';
/** 根据关键步骤或评论确定的条目状态，用于分组、排序和标签。 */
export type TicketReplyStatus = 'awaiting-receipt' | 'unreplied' | 'replied' | 'awaiting-others';
/** 展示使用的详情可用状态，最近一次重读的失败另由条目记录。 */
export type TicketVerification = 'pending' | 'ready' | 'failed';
/** 后台排序后的列表条目，身份信息不会进入此结构。 */
export type TicketListItem = TicketSummary & {
  group: TicketGroup;
  replyStatus: TicketReplyStatus;
  verification: TicketVerification;
  /** 已读表单中的产品型号，详情尚不可用时省略。 */
  productModel?: string;
  /** 当前展示使用的详情版本；重读失败时保留上一次有详情的读取时间。 */
  detailReadAt?: string | null;
  /** 本轮未能读到的环节及安全原因；读取成功时省略。 */
  failures?: TicketDetailFailure[];
};
/** 本轮全部近期单据的预读计数；补读结束后每张单据只计一次。 */
export type TicketPrefetchProgress = { completed: number; total: number; failed?: number };
/** 列表接口的即时内存快照；没有任何读取结果时 kind 为 loading。 */
export type TicketListSnapshot = Omit<TicketListResult, 'kind' | 'items'> & {
  kind: TicketReadKind | 'loading';
  items: TicketListItem[];
  updatedAt: string | null;
  isRefreshing: boolean;
  /** 后台实际安排的下一次刷新时刻；正在读取或没有安排时为 null。 */
  nextRefreshAt: string | null;
  /** 当前列表部分刷新，或本轮失败后保留同一账号的上次可用列表。 */
  listRefreshState?: 'stale' | 'partial';
  prefetch: TicketPrefetchProgress;
};
/** 带读取时间的详情响应；缓存命中时保留原读取时间，失败时允许为 null。 */
export type TicketDetailSnapshot = TicketDetailResult & { readAt: string | null };
