// 展示钉钉连接状态与登录、账号选择操作，供准备页使用。
import type { ReactElement } from 'react';
import type { DingtalkStatus } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { resolveCardStatus } from './card-status.ts';
import { ConnectionCard } from './connection-card.tsx';
import { COPY } from './copy.ts';
import { ProfilePicker } from './profile-picker.tsx';
import { ReasonNotice } from './reason-notice.tsx';
import { SetupCardActions } from './setup-card-actions.tsx';
import type { SetupCardActionsProps } from './setup-card-actions.tsx';
import type { RequestAction } from './use-request-action.ts';

/** 钉钉卡片状态和受控操作。 */
export type DingtalkCardProps = {
  status: DingtalkStatus | null;
  login: RequestAction<string | undefined>;
  selectProfile: RequestAction<string>;
  navigation: SetupCardActionsProps;
  onContinue?: () => void;
};

/**
 * 展示当前钉钉身份准备情况，并引导用户在外部授权页扫码。
 * @param props 已脱敏状态及登录、账号选择回调。
 * @returns 钉钉连接卡片。
 * @throws 无预期错误；业务失败按固定原因类别显示。
 */
export function DingtalkCard({
  status,
  login,
  selectProfile,
  navigation,
  onContinue,
}: DingtalkCardProps): ReactElement {
  const isLoggingIn = login.isPending || status?.isLoginInProgress === true;
  const { reason, state } = resolveCardStatus({
    status,
    actions: [login, selectProfile],
    isPending: isLoggingIn,
  });
  const account = status?.profiles.find(({ profile }) => profile === status.selectedProfile);
  const canContinue = status?.state === 'ready' && !isLoggingIn && !selectProfile.isPending;
  return (
    <ConnectionCard
      kind="dingtalk"
      title={COPY.dingtalk}
      description={COPY.dingtalkDescription}
      state={state}
      footer={
        <SetupCardActions {...navigation}>
          {onContinue && (
            <Button variant="primary" disabled={!canContinue} onClick={onContinue}>
              {COPY.nextStep}
            </Button>
          )}
        </SetupCardActions>
      }
    >
      {isLoggingIn ? (
        <p className="inline-message">{COPY.dingtalkWaiting}</p>
      ) : (
        <ReasonNotice reason={reason} />
      )}
      {!isLoggingIn && status?.isLoggedIn && account && (
        <p className="ready-message">
          {COPY.formatDingtalkAccount(
            account.label,
            account.accountName ?? COPY.dingtalkAccountUnknown,
          )}
        </p>
      )}
      {!status && <p className="muted">{COPY.unchecked}</p>}
      {status?.isLoggedIn && status.profiles.length > 1 && (
        <ProfilePicker
          profiles={status.profiles}
          selectedProfile={status.selectedProfile}
          isPending={selectProfile.isPending || isLoggingIn}
          onSelect={selectProfile.run}
        />
      )}
      <div className="card-actions">
        <Button
          variant={status?.isLoggedIn ? 'secondary' : 'primary'}
          disabled={isLoggingIn || status?.isInstalled === false}
          onClick={() => {
            // 网页只回传已选账号句柄，组织与身份信息由后台内部解析。
            void login.run(status?.selectedProfile ?? undefined);
          }}
        >
          {isLoggingIn ? COPY.loggingIn : status?.isLoggedIn ? COPY.relogin : COPY.login}
        </Button>
      </div>
    </ConnectionCard>
  );
}
