// 编排钉钉只读审批探针，汇总身份、分页与抽样结果。
import { errorType } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import type { Run } from './common.ts';
import { identify } from './identity.ts';
import { collectSources } from './readonly-page.ts';
import { collectSamples } from './readonly-sample.ts';
import { assertSummaryKeys } from './readonly-summary.ts';
import type { Options, ProbeProgress } from './readonly-types.ts';

export { errorType } from '../../core/src/index.ts';
export { parsePage } from './readonly-page.ts';
export { assertSummaryKeys, TEMPLATE_NAMES, SUMMARY_KEYS } from './readonly-summary.ts';
export type { Options } from './readonly-types.ts';

/**
 * 读取审批列表及有界样本，只返回通过白名单约束的脱敏摘要。
 * @param run 经过白名单校验的只读命令执行器。
 * @param options 时间范围、分页上限、抽样数量与可选身份。
 * @returns 摘要与退出码；0 为读取完整，2 为部分成功，1 为未获得成功结果。
 * @throws AppError 摘要出现未允许的字段时抛出；接口错误写入摘要。
 */
export async function probeReadonly(
  run: Run,
  options: Options,
): Promise<{ summary: JsonObject; exitCode: number }> {
  const summary: JsonObject = {
    pending: { pages: [], count: 0, maxPagesReached: false, incomplete: false },
    cc: { pages: [], count: 0, maxPagesReached: false, incomplete: false },
    templates: [],
    samples: [],
  };
  const progress: ProbeProgress = { goodCount: 0, isIncomplete: false };
  let identity;
  try {
    identity = await identify(run, options.profile);
  } catch (error) {
    summary.errorType = errorType(error);
    return { summary, exitCode: 1 };
  }
  const candidates = await collectSources(run, identity.profile, options, summary, progress);
  await collectSamples(run, identity, options, candidates, summary, progress);
  assertSummaryKeys(summary);
  return { summary, exitCode: progress.goodCount === 0 ? 1 : progress.isIncomplete ? 2 : 0 };
}
