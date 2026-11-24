// 提供钉钉已有账号的选择控件，供钉钉连接卡片使用。
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import type { DingtalkProfile } from '../../../packages/core/src/index.ts';
import { Button } from './button.tsx';
import { COPY } from './copy.ts';

/** 账号选择输入；只允许提交后台返回的完整 profile。 */
export type ProfilePickerProps = {
  profiles: DingtalkProfile[];
  selectedProfile: string | null;
  isPending: boolean;
  onSelect: (profile: string) => Promise<void>;
};

/**
 * 展示账号列表并提交用户确认的选择。
 * @param props 已有账号、当前选择及保存回调。
 * @returns 账号选择控件；空列表时不显示。
 * @throws 无预期错误；保存结果由上层操作状态显示。
 */
export function ProfilePicker({
  profiles,
  selectedProfile,
  isPending,
  onSelect,
}: ProfilePickerProps): ReactElement | null {
  const [profile, setProfile] = useState(selectedProfile ?? '');
  useEffect(() => {
    setProfile(selectedProfile ?? '');
  }, [selectedProfile]);
  if (profiles.length === 0) return null;
  return (
    <div className="profile-picker">
      <label htmlFor="profile">{COPY.profile}</label>
      <select
        id="profile"
        value={profile}
        onChange={(event) => setProfile(event.target.value)}
        disabled={isPending}
      >
        <option value="">{COPY.chooseProfile}</option>
        {profiles.map((item) => (
          <option key={item.profile} value={item.profile}>
            {item.label}
          </option>
        ))}
      </select>
      <Button
        disabled={!profile || profile === selectedProfile || isPending}
        onClick={() => {
          void onSelect(profile);
        }}
      >
        {isPending ? COPY.saving : COPY.saveProfile}
      </Button>
    </div>
  );
}
