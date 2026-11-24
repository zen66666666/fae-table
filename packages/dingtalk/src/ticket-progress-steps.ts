// 集中定义两种支持流程的正式节点、简称和已知的钉钉节点简写。
import { TICKET_TEMPLATES } from '../../core/src/index.ts';
import type { TicketProgress } from '../../core/src/index.ts';

/** 既有分组识别的确认收到节点名。 */
export const RECEIPT_STEP_NAME = '确认收到问题';
/** 既有分组识别的方案确认节点名。 */
export const SOLUTION_STEP_NAME = '问题解决方案及策略确认';

const RECEIPT_FULL_NAME = `${RECEIPT_STEP_NAME}，问题处理中`;
const SOLUTION_FULL_NAME = `(10分钟内)${SOLUTION_STEP_NAME}`;
const DEFAULT_STEPS: TicketProgress['steps'] = [
  { name: '复核信息完整性', shortName: '复核信息' },
  { name: RECEIPT_FULL_NAME, shortName: '确认收到' },
  { name: SOLUTION_FULL_NAME, shortName: '方案确认' },
  { name: '填写客户沟通结果', shortName: '沟通结果' },
];
const CUSTOMER_STEP = { name: '客服组FAE', shortName: '客服组FAE' };
const STEPS_BY_TEMPLATE = new Map<string, TicketProgress['steps']>([
  [TICKET_TEMPLATES.fast, DEFAULT_STEPS],
  [TICKET_TEMPLATES.service, [CUSTOMER_STEP, ...DEFAULT_STEPS]],
]);

function normalizeStepName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
}

const KNOWN_STEP_ALIASES = new Map<string, string>([
  [normalizeStepName(RECEIPT_STEP_NAME), normalizeStepName(RECEIPT_FULL_NAME)],
  [normalizeStepName(SOLUTION_STEP_NAME), normalizeStepName(SOLUTION_FULL_NAME)],
]);

/**
 * 读取当前受支持模板的公开步骤顺序。
 * @param templateName 已识别的审批模板名，未识别为 null。
 * @returns 模板的固定步骤，模板未支持时为 undefined。
 * @throws 无预期错误。
 */
export function getTicketProgressSteps(
  templateName: string | null,
): TicketProgress['steps'] | undefined {
  return templateName === null ? undefined : STEPS_BY_TEMPLATE.get(templateName);
}

/**
 * 将详情中的节点显示名精确匹配到当前模板，不根据未知文字猜测节点。
 * @param options 原始节点显示名及当前模板的固定步骤。
 * @returns 对应的位置，无可核实节点时为 -1。
 * @throws 无预期错误。
 */
export function getTicketProgressStepIndex(options: {
  name: string | null;
  steps: TicketProgress['steps'];
}): number {
  if (!options.name) return -1;
  const name = normalizeStepName(options.name);
  // 只处理全半角、空白和已经用于分组的两种完整简写，避免相似文字误标。
  const canonicalName = KNOWN_STEP_ALIASES.get(name) ?? name;
  return options.steps.findIndex((step) => normalizeStepName(step.name) === canonicalName);
}
