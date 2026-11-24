// 组合准备页状态与固定操作，供页面组件使用。
import { useState } from 'react';
import { createWorkbenchClient, RequestError } from './api-client.ts';
import type { WorkbenchClient } from './api-client.ts';
import { useConnectionStatus } from './use-connection-status.ts';
import type { ConnectionStatusState } from './use-connection-status.ts';
import type { PollingClock } from './polling-clock.ts';
import { useRequestAction } from './use-request-action.ts';
import type { RequestAction } from './use-request-action.ts';

const DEFAULT_CLIENT = createWorkbenchClient();

/** 可替换的页面请求客户端与轮询计时器。 */
export type WorkbenchOptions = {
  client?: WorkbenchClient;
  clock?: PollingClock;
  now?: () => number;
};
/** 准备页连接状态、退出状态以及本轮支持的四项写入操作。 */
export type WorkbenchModel = ConnectionStatusState & {
  client: WorkbenchClient;
  isStopped: boolean;
  login: RequestAction<string | undefined>;
  selectProfile: RequestAction<string>;
  setFolder: RequestAction<string>;
  shutdown: RequestAction<void>;
};

/**
 * 绑定准备页操作及成功后的状态刷新。
 * @param options 可替换的网络客户端和计时器，默认使用浏览器实现。
 * @returns 页面可直接消费的连接与操作状态。
 * @throws 无；请求错误由具体操作状态承载。
 */
export function useWorkbench(options: WorkbenchOptions = {}): WorkbenchModel {
  const client = options.client ?? DEFAULT_CLIENT;
  const [isStopped, setIsStopped] = useState(false);
  const connection = useConnectionStatus({ client, isStopped, clock: options.clock });
  const login = useRequestAction<string | undefined>({
    perform: async (profile) => {
      const result = await client.login(profile);
      if (result.kind !== 'success') throw new RequestError(result.reason);
    },
    onSuccess: connection.reload,
  });
  const selectProfile = useRequestAction<string>({
    perform: async (profile) => {
      await client.selectProfile(profile);
    },
    onSuccess: connection.reload,
  });
  const setFolder = useRequestAction<string>({
    perform: async (folder) => {
      const { catalog } = await client.setFolder(folder);
      connection.updateCatalogStatus(catalog);
      if (catalog.state !== 'ready') throw new RequestError(catalog.reason);
    },
  });
  const shutdown = useRequestAction<void>({
    perform: () => client.shutdown(),
    onSuccess: () => setIsStopped(true),
  });
  return { ...connection, client, isStopped, login, selectProfile, setFolder, shutdown };
}
