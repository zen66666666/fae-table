// 显示本机手册文件夹入口，供右栏展开的手册详情使用。
import type { ReactElement } from 'react';
import type { WorkbenchClient } from './api-client.ts';
import { Button } from './button.tsx';
import { MANUAL_COPY } from './manual-copy.ts';
import { useRequestAction } from './use-request-action.ts';

/** 打开本机手册文件夹的同源能力和当前目录状态。 */
export type ManualsHeadingProps = { client: WorkbenchClient; canOpenFolder: boolean };

/**
 * 目录可以使用时才提供打开按钮，目录刚失效时显示设置入口提示。
 * @param props 请求客户端和当前目录可用状态。
 * @returns 文件夹操作及失败提示，目录不可用时省略。
 * @throws 无预期错误；打开失败转换为固定中文提示。
 */
export function ManualsHeading({
  client,
  canOpenFolder,
}: ManualsHeadingProps): ReactElement | null {
  const openFolder = useRequestAction<void>({ perform: () => client.openManualsFolder() });
  if (!canOpenFolder) return null;
  return (
    <>
      <div className="manuals-panel-heading">
        <Button
          variant="quiet"
          disabled={openFolder.isPending}
          onClick={() => void openFolder.run()}
        >
          {openFolder.isPending ? MANUAL_COPY.openingFolder : MANUAL_COPY.openFolder}
        </Button>
      </div>
      {openFolder.reason !== 'none' && (
        <p className="manual-action-error" role="alert">
          {openFolder.reason === 'folder-required'
            ? MANUAL_COPY.folderRequired
            : MANUAL_COPY.openFolderFailed}
        </p>
      )}
    </>
  );
}
