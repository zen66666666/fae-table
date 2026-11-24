// 使用固定官网来源和路径生成手册与产品链接，供搜索、下载和索引恢复使用。
import { AppError } from '../../core/src/index.ts';
import type { ManualMatch } from '../../core/src/index.ts';
import { MANUAL_ORIGIN, MANUAL_PAGE, MANUAL_SEARCH, PRODUCT_PATH } from './constants.ts';
import type { ManualCandidate } from './search-page.ts';

/**
 * 验证产品编号能安全放进官网的固定数字路径。
 * @param productId 官网搜索或已验证索引中的产品编号。
 * @returns 符合统一长度和数字格式时为 true。
 * @throws 无预期错误。
 */
export function isManualProductId(productId: string): boolean {
  return PRODUCT_PATH.test(`${MANUAL_PAGE.product}${productId}${MANUAL_PAGE.extension}`);
}

/**
 * 生成官网固定搜索地址。
 * @param model 已验证且规范化的查询型号。
 * @returns 仅含指定官网路径和型号参数的地址。
 * @throws 固定来源常量无效时抛错。
 */
export function getManualSearchUrl(model: string): URL {
  const url = new URL(MANUAL_SEARCH.path, MANUAL_ORIGIN);
  url.searchParams.set(MANUAL_SEARCH.query, model);
  return url;
}

/**
 * 由已验证的匹配或索引生成一个安全匹配结果。
 * @param candidate 官网搜索或索引中的产品编号、型号与名称。
 * @param kind 匹配方式。
 * @returns 不包含下游可控地址的匹配，产品页由固定官网生成。
 * @throws AppError：编号格式不符。
 */
export function createManualMatch(
  candidate: ManualCandidate,
  kind: ManualMatch['kind'],
): ManualMatch {
  const { id, model, name } = candidate;
  return {
    productId: id,
    model,
    name,
    kind,
    productUrl: createManualPageUrl({ productId: id, segment: MANUAL_PAGE.product }).href,
  };
}

/**
 * 由成功匹配的数字编号生成唯一允许下载手册的地址。
 * @param productId 来自本机已知匹配的产品编号。
 * @returns 官网的固定下载 URL。
 * @throws AppError：编号格式不符。
 */
export function getManualDownloadUrl(productId: string): URL {
  return createManualPageUrl({ productId, segment: MANUAL_PAGE.download });
}

function createManualPageUrl(options: { productId: string; segment: string }): URL {
  const { productId, segment } = options;
  if (!isManualProductId(productId))
    throw new AppError('validation', 'manual_product_id', 'manuals');
  return new URL(`${segment}${productId}${MANUAL_PAGE.extension}`, MANUAL_ORIGIN);
}
