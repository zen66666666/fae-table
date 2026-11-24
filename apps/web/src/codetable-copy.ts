// 集中维护编码表状态、匹配类型和人物详情文案，供右栏资料组件使用。
import type {
  CodeTableMatch,
  CodeTableStatus,
  TicketPeopleResult,
} from '../../../packages/core/src/index.ts';

/** 资料中的编码表与人员列表固定文案。 */
export const CODETABLE_COPY = {
  heading: '研发人员',
  refresh: '更新编码表',
  updatedAt: '编码表更新于',
  expandPeople: '展开全部',
  collapsePeople: '收起',
  noPeople: '该型号暂无有效责任人',
  recordCount: '记录数',
  archivedAt: '最近归档日期',
  code: '编号',
  chip: '芯片型号',
  summary: '功能简述',
  requestFailed: '暂时无法读取编码表状态',
  emptySummary: '暂无人员',
  formatPeopleSummary: (name: string, count: number): string => `${name} 等 ${count} 人`,
} as const;

/** 编码表各阶段的提示；成功状态以更新时间表示。 */
export const CODETABLE_STATE_LABELS: Record<CodeTableStatus['state'], string> = {
  waiting: '等待加载编码表',
  loading: '正在加载编码表…',
  ready: '',
  failed: '编码表加载失败',
};

/** 区分编码表未就绪的具体原因，不展示钉钉或解析器原始输出。 */
export const CODETABLE_REASON_LABELS: Record<CodeTableStatus['reason'], string> = {
  none: '',
  permission: '当前钉钉账号没有读取编码表文件的权限',
  'login-required': '请登录钉钉后更新编码表',
  'not-found': '没有找到编码表文件',
  'multiple-files': '找到多个同名编码表文件',
  timeout: '读取编码表超时',
  'download-failed': '下载编码表失败',
  'parse-failed': '编码表格式无法解析',
  'cleanup-failed': '本机编码表临时文件清理失败',
};

/** 工单型号对应的匹配标记，两个前缀方向均属于近似匹配。 */
export const CODETABLE_MATCH_LABELS: Record<CodeTableMatch['kind'], string> = {
  exact: '完全一致',
  'table-prefix': '近似',
  'ticket-prefix': '近似',
};

/** 编码表匹配没有得到人员时的明确原因。 */
export const TICKET_PEOPLE_LABELS: Record<
  Exclude<TicketPeopleResult['kind'], 'matched'>,
  string
> = {
  'no-model': '单据没有填写产品型号',
  unmatched: '编码表中没有匹配的产品型号',
  'pending-detail': '正在读取单据型号…',
  'detail-unavailable': '无法读取单据型号',
  unavailable: '编码表暂不可用',
};

/** 研发人员收起时显示的简短状态。 */
export const TICKET_PEOPLE_SUMMARY_LABELS: Record<
  Exclude<TicketPeopleResult['kind'], 'matched'> | 'request-failed',
  string
> = {
  'no-model': '无型号',
  unmatched: '未找到',
  'pending-detail': '读取中…',
  'detail-unavailable': '暂时未读到',
  unavailable: '暂不可用',
  'request-failed': '暂不可用',
};
