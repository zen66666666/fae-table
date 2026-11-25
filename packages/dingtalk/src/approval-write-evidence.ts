// 比较预读与回读的任务和处理记录，供审批写入器核实一次钉钉写入。
import { isTicketFinished } from '../../core/src/index.ts';
import type { TicketWriteAction } from '../../core/src/index.ts';
import type { ApprovalTaskEvidence } from './approval-task-evidence.ts';
import { compareWriteRecords } from './approval-write-records.ts';
import type { ApprovalWriteRecord, ApprovalWriteRecords } from './approval-write-records.ts';
import type { Identity } from './identity.ts';
import { isTicketCommentAction } from './ticket-records.ts';

const COMMENT_LOOKBACK_MS = 120_000;
const AGREED_RESULT = 'AGREE';
const APPROVAL_CODES = new Set([AGREED_RESULT, 'APPROVE', 'APPROVED']);
const REJECT_CODES = new Set(['REFUSE', 'REJECT', 'REJECTED']);
const REVERT_FOR_RESUBMIT = 'REVERT_FOR_RESUBMIT';
const REVERT_ORIGINATOR_ID = 'sid-startevent';
const REVERT_CODES = new Set(['REVERT', 'REVERT_TASK', REVERT_FOR_RESUBMIT]);
const NORMAL_TASK_ACTION = 'EXECUTE_TASK_NORMAL';
const REDIRECT_PROCESS = 'REDIRECT_PROCESS';

type ApprovalRevertFields = Pick<
  ApprovalWriteRecord,
  'type' | 'result' | 'targetActivityId' | 'activityId' | 'revertAction'
>;

/**
 * 判断详情是否明确记录了一个节点的同意结果，供回复分组使用。
 * @param record 大写的动作和结果代码。
 * @returns 动作和结果均与详情接口的正式同意记录匹配时为 true。
 * @throws 无预期错误。
 */
export function isNormalApprovalAgreement(record: {
  type: string;
  result: string | null;
}): boolean {
  return record.type === NORMAL_TASK_ACTION && record.result === AGREED_RESULT;
}

/**
 * 判断是否为已确认的同意动作，兼容相同语义的两种审批记录封装。
 * @param record 归一化的大写动作和结果。
 * @returns 直接同意动作或普通任务的同意结果返回 true。
 * @throws 无预期错误。
 */
export function isApprovalAgreement(record: { type: string; result: string | null }): boolean {
  const { type, result } = record;
  return (
    APPROVAL_CODES.has(type) ||
    (type === NORMAL_TASK_ACTION && result !== null && APPROVAL_CODES.has(result))
  );
}

/**
 * 判断是否为明确的拒绝动作，兼容直接拒绝和普通任务的拒绝结果。
 * @param record 归一化的大写动作和结果。
 * @returns 已识别的拒绝动作返回 true。
 * @throws 无预期错误。
 */
export function isApprovalRejection(record: { type: string; result: string | null }): boolean {
  const { type, result } = record;
  return (
    REJECT_CODES.has(type) ||
    (type === NORMAL_TASK_ACTION && result !== null && REJECT_CODES.has(result))
  );
}

/**
 * 判断审批记录是否明确表示退回，供按处理时间计算单据进度使用。
 * @param record 大写的动作和结果代码，以及能核实退回的详情字段。
 * @returns 有已知的退回动作、结果或退回发起人的证据时为 true。
 * @throws 无预期错误。
 */
export function isApprovalRevertAction(record: ApprovalRevertFields): boolean {
  const { type, result } = record;
  return (
    REVERT_CODES.has(type) ||
    ((type === NORMAL_TASK_ACTION || type === REDIRECT_PROCESS) &&
      result !== null &&
      REVERT_CODES.has(result)) ||
    matchesOriginatorRevert(record)
  );
}

/**
 * 判断审批记录是否是已知的同意、拒绝或退回动作，供模块内判断处理顺序。
 * @param action 详情中的动作代码，由调用方规范化为大写。
 * @returns 已知任务处理动作为 true，转交由调用方另外核对。
 * @throws 无预期错误。
 */
export function isApprovalTaskAction(action: string): boolean {
  return (
    action === NORMAL_TASK_ACTION ||
    action === REDIRECT_PROCESS ||
    APPROVAL_CODES.has(action) ||
    REJECT_CODES.has(action) ||
    REVERT_CODES.has(action)
  );
}

/** 单次有效快照的证据；账号、任务和记录保留在钉钉模块内。 */
export type ApprovalEvidence = {
  id: string;
  identity: Identity;
  tasks: ApprovalTaskEvidence | null;
  status: string | null;
  ownedTaskId: string | null;
  records: ApprovalWriteRecords | null;
};

/** 写入未得到明确回应时的固定核实结论。 */
export type DingtalkWriteVerification = 'completed' | 'not-completed' | 'uncertain' | 'changed';

/**
 * 判断两个内部快照是否确属同一钉钉身份。
 * @param left 预读或预核实身份。
 * @param right 写入或回读所用身份。
 * @returns 账号、组织和人员标识都一致时为 true。
 * @throws 无预期错误。
 */
export function hasSameApprovalIdentity(left: Identity, right: Identity): boolean {
  return (
    left.profile === right.profile && left.corpId === right.corpId && left.userId === right.userId
  );
}

function matchesOriginatorRevert(record: ApprovalRevertFields): boolean {
  const { type, result } = record;
  // 重定向和通用退回不一定退给发起人；显式指向其他节点时不能视为本次退回。
  if (record.targetActivityId && record.targetActivityId !== REVERT_ORIGINATOR_ID) return false;
  return (
    (REVERT_CODES.has(type) || type === REDIRECT_PROCESS || type === NORMAL_TASK_ACTION) &&
    (type === REVERT_FOR_RESUBMIT ||
      result === REVERT_FOR_RESUBMIT ||
      record.revertAction === REVERT_FOR_RESUBMIT ||
      record.targetActivityId === REVERT_ORIGINATOR_ID ||
      record.activityId === REVERT_ORIGINATOR_ID)
  );
}

function matchesTaskAction(
  record: ApprovalWriteRecord,
  action: Exclude<TicketWriteAction, 'comment'>,
): boolean {
  return action === 'approve' ? isApprovalAgreement(record) : isApprovalRejection(record);
}

function hasNewSupplementalActor(options: {
  before: ApprovalWriteRecords;
  after: ApprovalWriteRecords;
  userId: string;
}): boolean {
  const { before, after, userId } = options;
  if (!after.supplementalRows) return false;
  const correlations = new Set(after.rows.map(({ correlation }) => correlation));
  // 即使写入前没有读到补充来源，写入后有孤立的本人或匿名记录也可能表示详情还没同步。
  if (
    after.supplementalRows.some(
      ({ actor, correlation }) =>
        (actor === null || actor === userId) && (!correlation || !correlations.has(correlation)),
    )
  )
    return true;
  if (!before.supplementalRows) return false;
  const { added } = compareWriteRecords({
    before: before.supplementalRows,
    after: after.supplementalRows,
  });
  // 补充接口可能抢先看到写入，只能否决“未完成”，不能独立证明写入结果。
  return added.some(({ actor }) => actor === null || actor === userId);
}

function verifyComment(options: {
  before: ApprovalWriteRecords;
  after: ApprovalWriteRecords;
  sentAt: number;
  userId: string;
  text: string;
}): boolean {
  const { before, after, sentAt, userId, text } = options;
  const earliest = sentAt - COMMENT_LOOKBACK_MS;
  const matches = (record: ApprovalWriteRecord): boolean =>
    (record.actor ?? record.supplementalActor) === userId &&
    isTicketCommentAction(record.type) &&
    record.remark === text &&
    Number.isFinite(record.time) &&
    record.time >= earliest;
  // 相同内容可能已发过，只有本次时间范围内的匹配条数真实增加才算生效。
  return after.rows.filter(matches).length > before.rows.filter(matches).length;
}

function verifyTaskWrite(options: {
  after: ApprovalEvidence;
  added: readonly ApprovalWriteRecord[];
  taskId: string;
  action: Exclude<TicketWriteAction, 'comment'>;
}): boolean {
  const { after, added, taskId, action } = options;
  return (
    after.tasks?.endedTaskIds.has(taskId) === true &&
    added.some(
      (record) =>
        (record.actor ?? record.supplementalActor) === after.identity.userId &&
        record.taskId === taskId &&
        matchesTaskAction(record, action),
    )
  );
}

function hasFlowChanged(options: {
  before: ApprovalEvidence;
  after: ApprovalEvidence;
  taskId: string | null;
}): boolean {
  const { before, after, taskId } = options;
  // 只比较原始状态和已完整核实的任务；读取失败或交叉确认不一致不能推断流程已变化。
  return (
    (before.status !== null && after.status !== null && before.status !== after.status) ||
    (taskId !== null &&
      (isTicketFinished(after) ||
        (after.tasks !== null && !after.tasks.detailOwnedRunningTaskIds.has(taskId))))
  );
}

/**
 * 用预读基线和本次回读的详情及任务核实一次写入。
 * @param options 同一账号与实例的前后证据、已确认的动作和正文、发送时间。
 * @returns 固定结论，包括明确的流程变化；不发起命令。
 * @throws 无预期错误。
 */
export function verifyApprovalEvidence(options: {
  before: ApprovalEvidence;
  after: ApprovalEvidence;
  action: TicketWriteAction;
  text: string;
  taskId: string | null;
  sentAt: number;
}): DingtalkWriteVerification {
  // 1. 核对账号、任务和基线。2. 核对已生效或流程变化。3. 只有确知未完成才允许重新操作。
  const { before, after, taskId, action, text, sentAt } = options;
  const isComment = action === 'comment';
  if (
    before.id !== after.id ||
    !hasSameApprovalIdentity(before.identity, after.identity) ||
    (!isComment && (!taskId || before.ownedTaskId !== taskId))
  )
    return 'uncertain'; // 1.
  const hasChanged = hasFlowChanged({ before, after, taskId: isComment ? null : taskId });
  if (!before.records || !after.records) return hasChanged ? 'changed' : 'uncertain';
  const { userId } = after.identity;
  if (
    isComment &&
    verifyComment({ before: before.records, after: after.records, sentAt, userId, text })
  )
    return 'completed'; // 2.
  const { added, hasBaseline } = compareWriteRecords({
    before: before.records.rows,
    after: after.records.rows,
  });
  if (!hasBaseline) return hasChanged ? 'changed' : 'uncertain';
  const oldCorrelations = new Set(
    before.records.supplementalRows?.map(({ correlation }) => correlation),
  );
  // 写入前在副来源已经出现的事件，不能因为此刻才进入详情就算成本次新写入。
  const candidates = added.filter(
    ({ correlation }) => !correlation || !oldCorrelations.has(correlation),
  );
  if (!isComment && taskId && verifyTaskWrite({ after, added: candidates, taskId, action }))
    return 'completed';
  if (hasChanged) return 'changed';
  // 辅助记录缺失时无法排除同步中的写入；匿名新增记录也可能属于本人。
  const hasNewActor = added.some(({ actor }) => actor === null || actor === userId);
  if (
    !after.records.supplementalRows ||
    hasNewActor ||
    hasNewSupplementalActor({ before: before.records, after: after.records, userId })
  )
    return 'uncertain'; // 3.
  return isComment || after.tasks?.taskId === taskId ? 'not-completed' : 'uncertain';
}
