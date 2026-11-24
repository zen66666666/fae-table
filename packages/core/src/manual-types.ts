// 定义官网手册查询的安全结果与单据接口末段，供后台、网页和官网查询模块共用。

/** 最近列表中指定单据的手册接口末段。 */
export const TICKET_MANUALS_SEGMENT = 'manuals';
/** 最近列表中指定单据的本机手册查看末段。 */
export const TICKET_MANUAL_VIEW_SEGMENT = 'view';
/** 显式重新下载单据手册的接口末段。 */
export const TICKET_MANUAL_REDOWNLOAD_SEGMENT = 'redownload';
/** 多型号单据选择手册的查询参数，仅能选中当前详情里已有的型号。 */
export const TICKET_MANUAL_MODEL_PARAMETER = 'model';
/** 手册文件夹的本机接口。 */
export const MANUALS_ROUTES = { openFolder: '/api/manuals/open-folder' } as const;

/** 官网返回的型号与简短名称，以及后台构造的固定路径和实际匹配方式。 */
export type ManualMatch = {
  productId: string;
  model: string;
  name: string;
  productUrl: string;
  kind: 'exact' | 'without-suffix';
};

/** 官网查询安全结果；未通过格式校验的型号不生成可访问的 URL。 */
export type ManualLookupResult =
  | { kind: 'found'; match: ManualMatch; searchUrl: string }
  | { kind: 'not-found'; searchUrl: string }
  | {
      kind: 'unavailable';
      reason: 'timeout' | 'network' | 'invalid-response';
      searchUrl: string;
      retryAt?: number;
    }
  | { kind: 'invalid-model'; searchUrl: null };

/** 已校验的本机存储状态，仅向网页公开下载日期。 */
export type ManualStoredStatus = { downloadedAt: string };

/** 单据详情、官网缓存与本机准备阶段，供右栏在后台查询时立即显示。 */
export type TicketManualResult =
  | Exclude<ManualLookupResult, { kind: 'found' }>
  | (Extract<ManualLookupResult, { kind: 'found' }> & {
      stored: ManualStoredStatus | null;
      isPreparing?: boolean;
    })
  | { kind: 'no-model' | 'pending-detail' | 'detail-unavailable' | 'loading' | 'folder-required' };

/** 单型号沿用单项结构，多型号按单据字段顺序提供独立查询和存储状态。 */
export type TicketManualsResult =
  | TicketManualResult
  | {
      kind: 'multiple';
      entries: { model: string; result: TicketManualResult }[];
    };
