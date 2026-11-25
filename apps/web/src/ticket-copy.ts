// 集中定义只读单据页面的固定文案和安全原因说明，由请求层及单据组件复用。
import { TICKET_TEMPLATES, TICKET_TEXT_PLACEHOLDER } from '../../../packages/core/src/index.ts';
import type {
  TicketGroup,
  TicketProgress,
  TicketReason,
  TicketReplyStatus,
} from '../../../packages/core/src/index.ts';
import { REASON_DETAILS } from './copy.ts';

const TICKET_COMMAND_RETRY_HINT = '请等待单据自动重试。';

/** 单据错误类别与下一步建议，不包含 CLI 原始输出。 */
export const TICKET_REASON_DETAILS: Record<TicketReason, { label: string; nextStep: string }> = {
  ...REASON_DETAILS,
  'command-start': { label: '钉钉命令没有启动成功', nextStep: TICKET_COMMAND_RETRY_HINT },
  'output-limit': { label: '钉钉命令输出超过上限', nextStep: TICKET_COMMAND_RETRY_HINT },
  aborted: { label: '钉钉读取被中止', nextStep: TICKET_COMMAND_RETRY_HINT },
  'exit-error': { label: '钉钉命令异常退出', nextStep: TICKET_COMMAND_RETRY_HINT },
  'invalid-response': { label: '钉钉返回格式不对', nextStep: TICKET_COMMAND_RETRY_HINT },
  'connection-required': {
    label: '需要先完成连接',
    nextStep: '请返回连接准备页，完成钉钉登录和账号选择。',
  },
  'page-limit': {
    label: '已达到读取页数上限',
    nextStep: '当前只展示已经读取的单据，列表可能不完整。',
  },
  'not-found': {
    label: '单据不在最近一次列表中',
    nextStep: '请返回列表并刷新，再重新打开单据。',
  },
};

/** 左栏按处理优先级展示的单据分组名称。 */
export const TICKET_GROUP_LABELS: Record<TicketGroup, string> = {
  pending: '待我处理',
  transferred: '移交给我',
  unreplied: '未回复',
  replied: '已回复',
  'transferred-out': '我移交给别人',
  finished: '已结束',
};

/** 左栏条目用于展示单据当前处理进度的标签。 */
export const TICKET_REPLY_STATUS_LABELS: Record<TicketReplyStatus, string> = {
  'awaiting-receipt': '待确认收到',
  unreplied: TICKET_GROUP_LABELS.unreplied,
  replied: TICKET_GROUP_LABELS.replied,
  'awaiting-others': '待他人通过',
};

/** 左栏空间有限，已支持的模板显示固定简称。 */
export const TICKET_TEMPLATE_LABELS: ReadonlyMap<string, string> = new Map([
  [TICKET_TEMPLATES.fast, '快速流程'],
  [TICKET_TEMPLATES.service, '客服流程'],
]);

/** 当前步骤处于哪一方的处理范围，供中栏和左栏共用。 */
export const TICKET_PROGRESS_LABELS: Record<TicketProgress['state'], string> = {
  'waiting-for-me': '等你',
  'transferred-to-me': '转交给你',
  'waiting-for-others': '等他人',
};

/** 列表、详情及连接入口的统一中文文案。 */
export const TICKET_COPY = {
  businessId: '审批编号',
  copyBusinessId: '复制审批编号',
  businessIdCopied: '已复制',
  businessIdCopyFailed: '复制失败',
  title: '技术支持单',
  refresh: '刷新',
  successEmpty: '暂无单据',
  detailUnavailable: '这张单据暂时没读到，下次刷新会再试',
  placeholder: TICKET_TEXT_PLACEHOLDER,
  titleLabel: '标题',
  createdAt: '创建时间',
  today: '今天',
  status: '状态',
  detail: '单据详情',
  fields: '关键字段',
  processProgress: '流程进度',
  stepComplete: '已完成',
  aiAnswering: 'AI 回答中',
  transferredOut: '已转交给他人',
  transferOutActivity: '对方已处理',
  transferOutQuiet: '暂无新动态',
  formatTransferOutHandler: (name: string, count: number): string =>
    count === 1 ? `${name}处理中` : `${name}等 ${count} 人处理中`,
  mine: '我',
  noFields: '没有可显示的表单字段。',
  settings: '连接设置',
  returnWorkbench: '返回工作台',
  refreshingBackground: '正在刷新…',
  formatNextRefresh: (minutes: number, seconds: number): string =>
    `${minutes} 分 ${seconds} 秒后自动刷新`,
  listPartlyUnread: '部分列表未读到',
  countSeparator: ' · ',
  formatReadSuccessCount: (count: number): string => `成功 ${count} 张`,
  formatReadFailureCount: (count: number): string => `失败 ${count} 张`,
  prefetchPending: '读取中',
  prefetchUnavailable: '暂未读到',
  autoRetryUnavailable: '暂时无法读取，稍后自动重试',
  noSelection: '请从左栏选择一张单据',
  waitPrefix: '已等 ',
  days: ' 天',
  hours: ' 小时',
  minutes: ' 分钟',
  unknownWait: '等待时长 —',
  notUpdated: '尚未更新',
  updatedMinutesAgo: ' 分钟前更新',
  expandList: '展开单据栏',
  listRail: '单据',
  collapseList: '收起单据栏',
  rightColumn: '资料和 AI 助手',
  aiConversation: 'AI 助手',
  aiMessageHistory: 'AI 助手消息',
  aiInput: '向 AI 助手提问',
  resources: '资料',
} as const;
