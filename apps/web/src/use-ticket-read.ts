// 复用列表和详情的异步读取状态，阻止卸载、切换账号或切换单据后的旧响应覆盖页面。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TicketReason } from '../../../packages/core/src/index.ts';
import { RequestError } from './api-client.ts';

/** 单据读取依赖；load 支持强制刷新，失败工厂只接收安全原因类别。 */
export type TicketReadOptions<Result> = {
  load: (isRefresh: boolean) => Promise<Result>;
  createFailure: (reason: TicketReason) => Result;
  isResultRetainedOnFailure?: boolean;
};

/** 只读页面当前结果、读取标记，以及主动刷新和只读重载入口。 */
export type TicketReadState<Result> = {
  result: Result | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
  acceptResult: (result: Result) => void;
};

/** 资料请求的安全失败，不暴露接口或上游原始输出。 */
export type TicketReadFailure = { kind: 'request-failed'; reason: TicketReason };

/**
 * 将安全原因包装为资料读取失败，用于与已取得的业务结果区分。
 * @param reason 允许显示的失败类别。
 * @returns 资料读取失败标记和原因。
 * @throws 无。
 */
export function createTicketReadFailure(reason: TicketReason): TicketReadFailure {
  return { kind: 'request-failed', reason };
}

/**
 * 加载单据并隔离旧请求，列表与详情共享同一错误和生命周期处理。
 * 1. 建立请求代次；2. 读取并仅接收当前结果；3. 撤销旧代次并接收新快照。
 * @param options 可替换的读取方法及失败结果工厂。
 * @returns 当前结果、等待状态和刷新函数。
 * @throws 无；网络异常转换为 failure 结果，绝不转换为空成功。
 */
export function useTicketRead<Result>(options: TicketReadOptions<Result>): TicketReadState<Result> {
  const { load, createFailure, isResultRetainedOnFailure } = options;
  const [result, setResult] = useState<Result | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // 1. 代次比较使离开页面后才到达的结果无法复活旧身份内容。
  const generation = useRef(0);
  const isActive = useRef(false);
  const isPending = useRef(false);
  const read = useCallback(
    async (isRefresh: boolean): Promise<void> => {
      if (!isActive.current || isPending.current) return;
      const currentGeneration = ++generation.current;
      isPending.current = true;
      setIsLoading(true);
      const isCurrent = () => isActive.current && generation.current === currentGeneration;
      try {
        // 2. 同一页面只发起一个读取，晚到的旧请求不覆盖当前页面。
        const response = await load(isRefresh);
        if (isCurrent()) setResult(response);
      } catch (error) {
        if (isCurrent()) {
          const failure = createFailure(error instanceof RequestError ? error.reason : 'unknown');
          setResult((previous) => (isResultRetainedOnFailure ? (previous ?? failure) : failure));
        }
      } finally {
        if (isCurrent()) {
          isPending.current = false;
          setIsLoading(false);
        }
      }
    },
    [load, createFailure, isResultRetainedOnFailure],
  );
  // 3. 账号由父组件 key 隔离；客户端或详情读取目标变化也会撤销旧代次。
  useEffect(() => {
    isActive.current = true;
    isPending.current = false;
    // 同一单据的缓存更新保留当前显示；切换单据或账号由父组件的 key 清空状态。
    void read(false);
    return () => {
      isActive.current = false;
      generation.current += 1;
    };
  }, [read]);
  const refresh = useCallback(() => read(true), [read]);
  const reload = useCallback(() => read(false), [read]);
  const acceptResult = useCallback((response: Result): void => {
    if (!isActive.current) return;
    // 3. 写入已确认的新快照后，较早开始的只读轮询不能还原该状态。
    generation.current += 1;
    isPending.current = false;
    setResult(response);
    setIsLoading(false);
  }, []);
  return { result, isLoading, refresh, reload, acceptResult };
}

/** 已完成的详情版本及其依赖请求状态。 */
export type TicketReadRevisionOptions = {
  cacheRevision: string;
  /** 已随本机更新响应直接收到的详情版本。 */
  acceptedRevision?: string;
  isLoading: boolean;
  reload: () => Promise<void>;
};

/**
 * 后台完成新的详情读取后取回依赖结果，当前请求结束后才接受新版本。
 * @param options 已完成的缓存版本与对应读取控制。
 * @returns 无返回值。
 * @throws 无；请求失败由读取状态处理。
 */
export function useTicketReadRevision(options: TicketReadRevisionOptions): void {
  const { cacheRevision, acceptedRevision, isLoading, reload } = options;
  const previousRevision = useRef(cacheRevision);
  useEffect(() => {
    // 预读中的空版本只表示尝试未完成，不能据此触发新的现场请求。
    if (isLoading || !cacheRevision || previousRevision.current === cacheRevision) return;
    previousRevision.current = cacheRevision;
    if (cacheRevision !== acceptedRevision) void reload();
  }, [cacheRevision, acceptedRevision, isLoading, reload]);
}
