// 收集详情实际需要显示的未知成员，并容错读取姓名；查询失败不改变单据读取完整性。
import type { JsonObject } from '../../core/src/index.ts';
import type { MemberNameResolver } from './member-name-resolver.ts';
import { readTicketText } from './ticket-values.ts';

/** 姓名读取所需的原始详情部分；完整身份只在钉钉模块内流转。 */
export type TicketMemberOptions = {
  payload: JsonObject;
  records: JsonObject[];
  tasks: JsonObject[];
  userId: string;
  resolveMemberNames: MemberNameResolver;
};

function collectUnknownMembers(options: TicketMemberOptions): string[] {
  const ids = new Set<string>();
  const addMember = (value: unknown, name: unknown): void => {
    const id = readTicketText(value);
    // 本人始终展示“我”，接口已有姓名也无需再次向通讯录查询。
    if (id !== null && id !== options.userId && readTicketText(name) === null) ids.add(id);
  };
  addMember(options.payload.originatorUserid, options.payload.originatorName);
  for (const record of options.records) addMember(record.userId, record.userName);
  for (const task of options.tasks) {
    // 网页只展示运行中的当前任务，历史任务不应额外触发通讯录读取。
    if (task.taskStatus === 'RUNNING') addMember(task.userId, task.userName);
  }
  return [...ids];
}

/**
 * 批量获取详情中缺少显示名的成员，不把姓名查询失败升级为单据失败。
 * @param options 已合并记录、任务、发起人和可替换姓名查询函数。
 * @returns 已核实姓名映射；查询失败时为空，由投影函数回退成员标识末四位。
 * @throws 无；原始通讯录错误和成员标识不写日志或进入网页。
 */
export async function resolveTicketMembers(
  options: TicketMemberOptions,
): Promise<ReadonlyMap<string, string>> {
  const ids = collectUnknownMembers(options);
  if (ids.length === 0) return new Map();
  try {
    const resolved = await options.resolveMemberNames(ids);
    return new Map(
      ids.flatMap((id) => {
        const name = readTicketText(resolved.get(id));
        return name === null ? [] : [[id, name] as const];
      }),
    );
  } catch {
    return new Map();
  }
}
