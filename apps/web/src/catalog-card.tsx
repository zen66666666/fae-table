// 展示本机产品资料目录与 PDF 数量，供准备页配置资料来源。
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { CatalogFolderPickResult, CatalogStatus } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { resolveCardStatus } from './card-status.ts';
import { ConnectionCard } from './connection-card.tsx';
import { COPY } from './copy.ts';
import { ReasonNotice } from './reason-notice.tsx';
import { SetupCardActions } from './setup-card-actions.tsx';
import type { SetupCardActionsProps } from './setup-card-actions.tsx';
import type { RequestAction } from './use-request-action.ts';

/** 资料卡片的目录状态与保存操作。 */
export type CatalogCardProps = {
  status: CatalogStatus | null;
  save: RequestAction<string>;
  isSetup: boolean;
  navigation: SetupCardActionsProps;
  pickFolder: () => Promise<CatalogFolderPickResult>;
};

const FOLDER_FORM_ID = 'catalog-folder-form';
const PICK_NOTICES: Record<Exclude<CatalogFolderPickResult['kind'], 'selected'>, string> = {
  cancelled: COPY.folderPickCancelled,
  busy: COPY.folderPickBusy,
  unsupported: COPY.folderPickFailed,
  failed: COPY.folderPickFailed,
};

function useFolderDraft(pickFolder: CatalogCardProps['pickFolder']) {
  const [draft, setDraft] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [notice, setNotice] = useState('');
  async function choose(): Promise<void> {
    setIsPicking(true);
    setNotice('');
    try {
      const result = await pickFolder();
      if (result.kind === 'selected') setDraft(result.folder);
      else setNotice(PICK_NOTICES[result.kind]);
    } catch {
      setNotice(COPY.folderPickFailed);
    } finally {
      setIsPicking(false);
    }
  }
  return { draft, setDraft, choose, isPicking, notice };
}

/**
 * 让用户填写资料目录，目录验证和 PDF 统计交给后台。
 * @param props 已检查的目录状态、保存回调和当前页面模式。
 * @returns 产品资料连接卡片。
 * @throws 无预期错误；目录失败只显示固定原因类别。
 */
export function CatalogCard({
  status,
  save,
  isSetup,
  navigation,
  pickFolder,
}: CatalogCardProps): ReactElement {
  const { draft, setDraft, choose, isPicking, notice } = useFolderDraft(pickFolder);
  // 轮询可以稍后给出建议，但不能覆盖用户已输入或主动清空的内容。
  const folder = draft ?? status?.folder ?? status?.suggestedFolder ?? '';
  const { reason, state } = resolveCardStatus({ status, actions: [save] });
  const saveLabel = isSetup ? COPY.saveFolderAndEnter : COPY.saveFolder;
  const isBusy = save.isPending || isPicking;
  return (
    <ConnectionCard
      kind="catalog"
      title={COPY.catalog}
      description={COPY.catalogDescription}
      state={state}
      footer={
        <SetupCardActions {...navigation}>
          <Button
            form={FOLDER_FORM_ID}
            type="submit"
            variant="primary"
            disabled={!folder.trim() || isBusy}
          >
            {save.isPending ? COPY.saving : saveLabel}
          </Button>
        </SetupCardActions>
      }
    >
      {status?.state === 'ready' && (
        <div>
          <p className="pdf-summary">
            {status.pdfCountLimit !== undefined ? (
              <>
                <span>{COPY.scannedEntries}</span>
                <strong>{COPY.formatScannedEntryLimit(status.pdfCountLimit)}</strong>
              </>
            ) : (
              <>
                <strong>{status.pdfCount}</strong> {COPY.pdfCount}
              </>
            )}
          </p>
          {status.isPdfCountLimited && <p className="field-hint">{COPY.pdfCountLimited}</p>}
        </div>
      )}
      {reason !== 'folder-required' && <ReasonNotice reason={reason} />}
      <form
        id={FOLDER_FORM_ID}
        className="folder-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isBusy && folder.trim()) void save.run(folder.trim());
        }}
      >
        <label htmlFor="catalog-folder">{COPY.catalogLabel}</label>
        <div className="catalog-folder-row">
          <input
            id="catalog-folder"
            required
            value={folder}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={COPY.catalogPlaceholder}
            disabled={isBusy}
            autoComplete="off"
            spellCheck={false}
          />
          {status?.canPickFolder && (
            <Button disabled={isBusy} onClick={() => void choose()}>
              {isPicking ? COPY.pickingFolder : COPY.pickFolder}
            </Button>
          )}
        </div>
        {notice && (
          <p className="field-hint" role="status">
            {notice}
          </p>
        )}
      </form>
    </ConnectionCard>
  );
}
