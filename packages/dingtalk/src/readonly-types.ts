// 定义只读审批探针的输入、分页摘要和内部执行状态。
import type { JsonObject } from '../../core/src/index.ts';

/** 探针查询范围、分页与抽样上限；now 可注入固定的结束时间。 */
export type Options = {
  days: number;
  pageSize: number;
  maxPages: number;
  sample: number;
  profile?: string;
  now?: number;
};

/** 单页调用的脱敏结果，不包含审批内容与用户标识。 */
export type PageSummary = {
  page: number;
  success: boolean;
  count?: number;
  hasMore?: boolean;
  endpointExhausted?: boolean;
  nextPage?: number;
  errorType?: string;
};

/** 一类列表的累计摘要，标记分页是否完整。 */
export type SourceSummary = {
  pages: PageSummary[];
  count: number;
  maxPagesReached: boolean;
  incomplete: boolean;
};

/** 已通过列表结构校验的审批实例，仅在内存中保留原始字段。 */
export type Instance = JsonObject & { processInstanceId: string };

/** 匹配到支持模板的抽样候选，仅在内存中使用。 */
export type Candidate = { name: string; instance: Instance };

/** 聚合成功调用次数与部分失败状态，用于确定探针退出码。 */
export type ProbeProgress = { goodCount: number; isIncomplete: boolean };
