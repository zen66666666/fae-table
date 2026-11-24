// 集中定义官网手册匹配、链接和失败文案，供右栏手册区使用。
import type { ManualMatch, TicketManualResult } from '../../../packages/core/src/index.ts';

const MANUAL_PREFERENCE_PREFIX = 'fae-workbench:manual-expanded:';

/** 相关手册区的链接文字。 */
export const MANUAL_COPY = {
  heading: '手册',
  statusSeparator: ' · ',
  manual: '打开用户手册',
  open: '打开',
  summaryStored: '已存本机',
  product: '产品页面',
  search: '到官网搜索',
  refresh: '更新',
  stored: '已存到本机 ·',
  firstOpen: '首次打开时下载',
  redownload: '重新下载',
  redownloading: '正在下载…',
  redownloadFailed: '重新下载失败，请稍后重试',
  openFolder: '打开手册文件夹',
  openingFolder: '正在打开…',
  openFolderFailed: '暂时无法打开手册文件夹',
  folderRequired: '请先在设置里选择产品资料文件夹',
} as const;

/** 官网识别成功时对应的型号匹配方式。 */
export const MANUAL_MATCH_LABELS: Record<ManualMatch['kind'], string> = {
  exact: '完全一致',
  'without-suffix': '去后缀',
};

/** 右栏没有找到手册或尚未完成查询时的明确状态。 */
export const MANUAL_STATUS_LABELS: Record<
  Exclude<TicketManualResult['kind'], 'found' | 'unavailable'>,
  string
> = {
  loading: '正在查询官网…',
  'pending-detail': '正在读取单据型号…',
  'detail-unavailable': '无法读取单据型号',
  'no-model': '单据没有填写产品型号',
  'invalid-model': '当前型号无法用于官网搜索',
  'not-found': '官网没有找到这个型号',
  'folder-required': MANUAL_COPY.folderRequired,
};

/** 收起状态下的手册文案，保持状态和操作在同一行。 */
export const MANUAL_SUMMARY_LABELS: Record<
  Exclude<TicketManualResult['kind'], 'found'> | 'request-failed',
  string
> = {
  loading: '读取中',
  'pending-detail': '读取中',
  'detail-unavailable': '暂时未读到',
  'no-model': '无型号',
  'invalid-model': '型号无法查询',
  'not-found': '没找到',
  'folder-required': '未设置资料文件夹',
  unavailable: '暂不可用',
  'request-failed': '暂不可用',
};

/**
 * 为第几行手册生成界面偏好键。
 * @param index 按单据顺序排列的手册行下标。
 * @returns 只含行号的存储键，浏览器偏好不包含型号或单据数据。
 * @throws 无预期错误。
 */
export function getManualPreferenceKey(index: number): string {
  return `${MANUAL_PREFERENCE_PREFIX}${index}`;
}
