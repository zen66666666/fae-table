// 读取候选审批的详情、记录与任务，并生成脱敏抽样摘要。
import { createHash } from 'node:crypto';
import { AppError, errorType, isObject } from '../../core/src/index.ts';
import type { JsonObject } from '../../core/src/index.ts';
import type { Run } from './common.ts';
import type { Identity } from './identity.ts';
import { isCurrentTaskActor, readApprovalPayload } from './approval-reading.ts';
import { collectFieldNames, hasNonemptyAttachment } from './readonly-payload.ts';
import { TEMPLATE_NAMES } from './readonly-summary.ts';
import type { Candidate, Instance, Options, ProbeProgress } from './readonly-types.ts';

type SampleContext = {
  identity: Identity;
  name: string;
  instance: Instance;
  templates: JsonObject[];
  progress: ProbeProgress;
};

function addDetailSummary(payload: JsonObject, sample: JsonObject, context: SampleContext): void {
  const code = payload.processCode as string;
  // 模板编码只能是限定字符的标识，不能将任意标题或正文写入摘要。
  if (!/^(?:PROC-|SYN-)[A-Za-z0-9_-]{1,180}$/.test(code)) {
    throw new AppError('structure', 'invalid_template_code', 'detail');
  }
  if (
    !context.templates.some(
      (template) => template.templateName === context.name && template.processCode === code,
    )
  ) {
    context.templates.push({ templateName: context.name, processCode: code });
  }
  const fields = payload.formValueVOS as JsonObject[];
  const tasks = payload.tasks as JsonObject[];
  sample.hasModelField = fields.some(
    (field) => typeof field.name === 'string' && field.name.includes('型号'),
  );
  sample.hasAttachments =
    fields.some(
      (field) => field.componentType === 'DDAttachment' && hasNonemptyAttachment(field.value),
    ) ||
    hasNonemptyAttachment(payload.attachments) ||
    (Array.isArray(payload.operationRecords) &&
      payload.operationRecords.some(
        (record) => isObject(record) && hasNonemptyAttachment(record.attachments),
      ));
  sample.hasCurrentTask = tasks.some((task) => task.taskStatus === 'RUNNING');
  // 历史已完成任务不代表当前处理权限，必须同时匹配运行状态与当前用户。
  sample.currentUserIsTaskActor = isCurrentTaskActor(tasks, context.identity.userId);
  const ids = tasks
    .filter((task) => task.taskId !== undefined && task.taskId !== null)
    .map((task) => String(task.taskId));
  if (ids.length)
    sample.instanceIdDiffersFromTaskId = ids.every(
      (id) => id !== context.instance.processInstanceId,
    );
}

async function readSample(run: Run, context: SampleContext): Promise<JsonObject> {
  const sample: JsonObject = {
    templateName: context.name,
    instanceHash: createHash('sha256')
      .update(context.instance.processInstanceId)
      .digest('hex')
      .slice(0, 10),
  };
  for (const leaf of ['detail', 'records', 'tasks'] as const) {
    try {
      const payload = await readApprovalPayload({
        run,
        leaf,
        instanceId: context.instance.processInstanceId,
        profile: context.identity.profile,
      });
      sample[leaf] = { success: true, fields: collectFieldNames(payload) };
      context.progress.goodCount++;
      if (leaf === 'detail') addDetailSummary(payload, sample, context);
    } catch (error) {
      sample[leaf] = { success: false, errorType: errorType(error) };
      context.progress.isIncomplete = true;
    }
  }
  return sample;
}

/**
 * 按模板顺序抽取有界数量的候选，逐个读取三类只读接口。
 * @param run 经过白名单校验的执行器。
 * @param identity 已核实的当前用户身份。
 * @param options 每类模板的抽样上限。
 * @param candidates 列表读取阶段收集的候选实例。
 * @param summary 接收模板与抽样信息的摘要。
 * @param progress 接收成功次数和部分失败标记。
 * @returns 完成时无返回值，结果写入 summary。
 * @throws 接口错误记录到样本；无法建立实例哈希等运行错误继续向上传播。
 */
export async function collectSamples(
  run: Run,
  identity: Identity,
  options: Options,
  candidates: Candidate[],
  summary: JsonObject,
  progress: ProbeProgress,
): Promise<void> {
  const templates = summary.templates as JsonObject[];
  const samples = summary.samples as JsonObject[];
  for (const name of TEMPLATE_NAMES) {
    for (const { instance } of candidates
      .filter((candidate) => candidate.name === name)
      .slice(0, options.sample)) {
      samples.push(await readSample(run, { identity, name, instance, templates, progress }));
    }
  }
}
