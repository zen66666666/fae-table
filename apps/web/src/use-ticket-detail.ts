// 管理选中单据的首次读取与预读完成后的缓存回取，不因轮询或重新核实而重复现场读取。
import { useCallback, useEffect } from 'react';
import { createTicketDetailSnapshotFailure } from '../../../packages/core/src/index.ts';
import type { TicketDetailSnapshot } from '../../../packages/core/src/index.ts';
import type { WorkbenchClient } from './api-client.ts';
import { useTicketRead, useTicketReadRevision } from './use-ticket-read.ts';
import type { TicketReadState } from './use-ticket-read.ts';

/** 当前单据的接口和已完成的缓存版本；空版本表示后台尚在预读。 */
export type TicketDetailReadOptions = {
  id: string;
  client: WorkbenchClient;
  cacheRevision: string;
  updatedDetail?: TicketDetailSnapshot;
};

/**
 * 首次选择时读取详情，随后只在已完成的预读版本变化时读取缓存。
 * @param options 单据标识、同源接口及预读版本。
 * @returns 独立的详情读取结果和等待状态。
 * @throws 无；接口错误由共享读取钩子转换为安全失败结果。
 */
export function useTicketDetail(
  options: TicketDetailReadOptions,
): TicketReadState<TicketDetailSnapshot> {
  const { id, client, cacheRevision, updatedDetail } = options;
  const load = useCallback(() => client.getTicketDetail(id), [client, id]);
  const state = useTicketRead({ load, createFailure: createTicketDetailSnapshotFailure });
  const { acceptResult } = state;
  const hasDetail = Boolean(state.result?.detail);
  useEffect(() => {
    // 已显示的内容不会被一次手动重读失败清空，后台会单独记录失败和安排补读。
    if (updatedDetail && (updatedDetail.kind === 'success' || !hasDetail))
      acceptResult(updatedDetail);
  }, [acceptResult, hasDetail, updatedDetail]);
  const acceptedRevision = updatedDetail?.readAt
    ? `${updatedDetail.readAt}:${updatedDetail.detail ? 'ready' : 'failed'}`
    : undefined;
  useTicketReadRevision({
    cacheRevision,
    acceptedRevision,
    isLoading: state.isLoading,
    reload: state.reload,
  });
  return state;
}
