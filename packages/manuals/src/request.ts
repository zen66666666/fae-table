// 仅向允许的官网搜索地址发送型号请求，生成可直接打开的产品和资料链接。
import { AppError, discardResponse, readBoundedResponseText } from '../../core/src/index.ts';
import type { ManualLookupResult } from '../../core/src/index.ts';
import { MANUAL_HTML_LIMIT_BYTES, MANUAL_REQUEST_TIMEOUT_MS } from './constants.ts';
import { createManualMatch, getManualSearchUrl } from './links.ts';
import { getManualBaseModel } from './model.ts';
import { isManualOfficialResponse, MANUAL_REQUEST_POLICY } from './official-response.ts';
import { parseManualSearchPage } from './search-page.ts';
import type { ManualCandidate } from './search-page.ts';

/** 官网查询可替换的 HTTP 实现、计时信号和实例停止信号。 */
export type ManualRequestOptions = {
  fetch?: typeof fetch;
  createTimeoutSignal?: (milliseconds: number) => AbortSignal;
  signal?: AbortSignal;
};

type ManualFailure = Extract<ManualLookupResult, { kind: 'unavailable' }>['reason'];
type PageLookup = { candidate?: ManualCandidate; reason?: ManualFailure };

async function fetchExactMatch(
  options: ManualRequestOptions & { model: string },
): Promise<PageLookup> {
  // 1. 构造固定来源及截止信号。2. 获取有界页面。3. 分类并挑选精确型号。
  if (options.signal?.aborted) return { reason: 'network' };
  const url = getManualSearchUrl(options.model); // 1.
  const timeout = (options.createTimeoutSignal ?? AbortSignal.timeout)(MANUAL_REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      // 2.
      ...MANUAL_REQUEST_POLICY,
      headers: { Accept: 'text/html' },
      signal,
    });
    if (!isManualOfficialResponse(response, url)) {
      discardResponse(response);
      return { reason: 'network' };
    }
    const page = parseManualSearchPage(
      await readBoundedResponseText(response, MANUAL_HTML_LIMIT_BYTES),
    ); // 3.
    if (!page.hasExpectedStructure) return { reason: 'invalid-response' };
    return { candidate: page.candidates.find((entry) => entry.model === options.model) };
  } catch (error) {
    if (timeout.aborted) return { reason: 'timeout' };
    return { reason: error instanceof AppError ? 'invalid-response' : 'network' };
  }
}

/**
 * 精确查询型号；只有确认无匹配时才允许试一次去后缀的精确查询。
 * @param options 已校验的原始型号和可替换网络依赖。
 * @returns 安全查询结果及原型号的官网搜索链接，不返回上游 HTML 或错误正文。
 * @throws 预期的官网和网络失败均映射到固定结果。
 */
export async function requestManual(
  options: ManualRequestOptions & { model: string },
): Promise<ManualLookupResult> {
  // 1. 用原型号做精确查询。2. 无匹配才去掉一个允许的后缀再次精确查询。
  const searchUrl = getManualSearchUrl(options.model).href;
  const original = await fetchExactMatch(options); // 1.
  if (original.reason) return { kind: 'unavailable', reason: original.reason, searchUrl };
  if (original.candidate)
    return { kind: 'found', match: createManualMatch(original.candidate, 'exact'), searchUrl };
  const base = getManualBaseModel(options.model); // 2.
  if (!base) return { kind: 'not-found', searchUrl };
  const fallback = await fetchExactMatch({ ...options, model: base });
  if (fallback.reason) return { kind: 'unavailable', reason: fallback.reason, searchUrl };
  return fallback.candidate
    ? { kind: 'found', match: createManualMatch(fallback.candidate, 'without-suffix'), searchUrl }
    : { kind: 'not-found', searchUrl };
}
