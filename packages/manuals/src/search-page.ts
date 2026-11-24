// 从官网搜索 HTML 中提取合法产品锚点和可辨认的空结果，供资料查询使用。
import { MANUAL_NAME_MAX_LENGTH, MANUAL_ORIGIN, PRODUCT_PATH } from './constants.ts';
import { readHtml } from './html.ts';
import type { HtmlEvent } from './html.ts';
import { normalizeManualModel } from './model.ts';

const MODEL_HEADING = { tag: 'h2', className: 't1' } as const;
const NAME_HEADING = { tag: 'h3', className: 't2' } as const;
const RESULTS_LIST = { tag: 'ul', className: 'classlistd' } as const;
const INVALID_LINK_TEXT = /[\x00-\x1f\x7f\\]/u;

/** 从官网固定产品路径和明确标题结构读取的候选；只在查询过程内使用。 */
export type ManualCandidate = { id: string; model: string; name: string };

/** 解析过的候选和可识别页面标记，供查询区分无匹配与未知结构。 */
export type ManualSearchPage = { candidates: ManualCandidate[]; hasExpectedStructure: boolean };

function getProductId(href: string): string | undefined {
  if (!href || INVALID_LINK_TEXT.test(href)) return undefined;
  try {
    const url = new URL(href, MANUAL_ORIGIN);
    if (url.origin !== MANUAL_ORIGIN || url.username || url.password || url.search || url.hash)
      return undefined;
    return PRODUCT_PATH.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
}

function hasElementClass(event: HtmlEvent, element: { tag: string; className: string }): boolean {
  return (
    event.kind === 'start' &&
    event.name === element.tag &&
    (event.attributes.get('class')?.split(/\s+/u).includes(element.className) ?? false)
  );
}

class ProductCard {
  private heading: 'model' | 'name' | undefined;
  private readonly model: string[] = [];
  private readonly name: string[] = [];
  private readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  append(event: HtmlEvent): void {
    if (hasElementClass(event, MODEL_HEADING)) this.heading = 'model';
    else if (hasElementClass(event, NAME_HEADING)) this.heading = 'name';
    else if (
      event.kind === 'end' &&
      ((this.heading === 'model' && event.name === MODEL_HEADING.tag) ||
        (this.heading === 'name' && event.name === NAME_HEADING.tag))
    )
      this.heading = undefined;
    else if (event.kind === 'text' && this.heading) this[this.heading].push(event.text);
  }

  finish(): ManualCandidate | undefined {
    const model = normalizeManualModel(this.model.join(''));
    const name = this.name.join('').replace(/\s+/gu, ' ').trim().slice(0, MANUAL_NAME_MAX_LENGTH);
    return model && name ? { id: this.id, model, name } : undefined;
  }
}

class ResultList {
  private depth = 1;
  private hasContent = false;
  private isProductItem = false;
  private card?: ProductCard;
  private readonly candidates: ManualCandidate[] = [];

  append(event: HtmlEvent): void {
    if (event.kind !== 'text' && event.name === RESULTS_LIST.tag) {
      if (event.kind === 'start') this.hasContent = true;
      this.depth += event.kind === 'start' ? 1 : -1;
      return;
    }
    if (this.depth !== 1) return;
    if (event.kind === 'start' || (event.kind === 'text' && event.text.trim()))
      this.hasContent = true;
    if (event.kind !== 'text' && event.name === 'li') {
      this.isProductItem = event.kind === 'start';
      this.card = undefined;
      return;
    }
    // 页头推荐商品不在搜索结果列表的条目中，不能作为搜索命中。
    if (!this.isProductItem) return;
    if (event.kind === 'start' && event.name === 'a') {
      const id = getProductId(event.attributes.get('href') ?? '');
      this.card = id ? new ProductCard(id) : undefined;
    } else if (event.kind === 'end' && event.name === 'a') {
      const candidate = this.card?.finish();
      if (candidate) this.candidates.push(candidate);
      this.card = undefined;
    } else this.card?.append(event);
  }

  finish(): ManualSearchPage {
    return {
      candidates: this.candidates,
      // 官网无结果时保留空 ul；未知结构的非空列表不能误报为无结果。
      hasExpectedStructure: this.depth === 0 && (!this.hasContent || this.candidates.length > 0),
    };
  }

  isClosed(): boolean {
    return this.depth === 0;
  }
}

/**
 * 读取候选锚点里的明确型号和产品名，并确认可以安全判断无匹配。
 * @param html 已受大小限制的官网 HTML。
 * @returns 已验证候选和已知结构标记，不保留原始 HTML。
 * @throws 无预期错误；缺失结构以标记返回。
 */
export function parseManualSearchPage(html: string): ManualSearchPage {
  // 1. 定位官网的结果列表。2. 只检查该列表的候选或空结果结构。
  let results: ResultList | undefined;
  for (const event of readHtml(html)) {
    if (!results) {
      if (hasElementClass(event, RESULTS_LIST)) results = new ResultList(); // 1.
      continue;
    }
    results.append(event); // 2.
    if (results.isClosed()) return results.finish();
  }
  return { candidates: [], hasExpectedStructure: false };
}
