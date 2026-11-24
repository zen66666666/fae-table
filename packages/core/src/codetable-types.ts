// 共享本机编码表、型号匹配与研发人员接口的契约，供后台和网页使用。

/** 编码表状态与手动刷新使用的固定本机路径。 */
export const CODETABLE_ROUTES = {
  status: '/api/codetable/status',
  refresh: '/api/codetable/refresh',
} as const;

/** 指定可见单据的研发人员接口末段。 */
export const TICKET_PEOPLE_SEGMENT = 'people';

/** 可公开的编码表错误类别；不包含外部命令原文和路径。 */
export type CodeTableReason =
  | 'none'
  | 'permission'
  | 'login-required'
  | 'not-found'
  | 'multiple-files'
  | 'timeout'
  | 'download-failed'
  | 'parse-failed'
  | 'cleanup-failed';

/** 编码表内存索引状态；retryAt 仅在短期退避等待时提供 ISO 时间。 */
export type CodeTableStatus = {
  state: 'waiting' | 'loading' | 'ready' | 'failed';
  reason: CodeTableReason;
  updatedAt: string | null;
  modelCount: number;
  retryAt: string | null;
};

/** 同型号下研发人员的记录汇总；归档日期是 YYYY-MM-DD 日历日期。 */
export type CodeTablePerson = {
  name: string;
  recordCount: number;
  archivedAt: string | null;
  code: string | null;
  chip: string | null;
  summary: string | null;
};

/** 一个匹配型号、实际匹配规则及按最近归档日期排序的研发人员。 */
export type CodeTableMatch = {
  model: string;
  kind: 'exact' | 'table-prefix' | 'ticket-prefix';
  people: CodeTablePerson[];
};

/** 指定单据的匹配结果；只有匹配成功时提供对应型号和研发人员。 */
export type TicketPeopleResult = {
  kind:
    | 'matched'
    | 'no-model'
    | 'unmatched'
    | 'pending-detail'
    | 'detail-unavailable'
    | 'unavailable';
  matches: CodeTableMatch[];
};
