// 通过固定系统脚本打开一个本机资料文件夹选择窗口，供已授权的设置接口使用。
import path from 'node:path';
import { runPowerShell } from '../../../packages/core/src/index.ts';
import type {
  CatalogFolderPickResult,
  PowerShellOptions,
} from '../../../packages/core/src/index.ts';

const PICK_TIMEOUT_MS = 300_000;
const PICK_PATH_BYTES = 16_384;
const FOLDER_PICKER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.TopMost = $true',
  '$owner.ShowInTaskbar = $false',
  '$owner.Opacity = 0',
  '$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
  '$picker = New-Object System.Windows.Forms.FolderBrowserDialog',
  "$picker.Description = '选择产品资料文件夹'",
  '$picker.ShowNewFolderButton = $false',
  'try {',
  '  $owner.Show()',
  '  $owner.Activate()',
  '  if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {',
  '    [Console]::Out.Write($picker.SelectedPath)',
  '  }',
  '} finally {',
  '  $picker.Dispose()',
  '  $owner.Dispose()',
  '}',
].join('\n');

/** 目录选择脚本可以使用替换的系统环境和运行器，供独立自检。 */
export type PickCatalogFolderOptions = Pick<
  PowerShellOptions,
  'environment' | 'run' | 'signal' | 'spawn'
>;

/**
 * 1. 用固定脚本显示带置顶所有者的目录选择窗口。2. 读取用户确认的路径或取消状态。
 * @param options 系统定位、进程和取消信号；不接受网页参数。
 * @returns 已选择、取消或固定失败类别；不修改任何资料目录配置。
 * @throws 无预期错误；系统错误不会把诊断或本机路径交给网页。
 */
export async function pickCatalogFolder(
  options: PickCatalogFolderOptions = {},
): Promise<CatalogFolderPickResult> {
  try {
    // 1. 只将固定脚本交给系统进程，STA 是 Windows 图形选择窗口的线程要求。
    const result = await runPowerShell({
      ...options,
      script: FOLDER_PICKER_SCRIPT,
      isSta: true,
      timeoutMs: PICK_TIMEOUT_MS,
      maxOutputBytes: PICK_PATH_BYTES,
    });
    // 2. 标准输出为空表示用户取消。保存时仍按现有本机目录约束完整检查。
    if (result.failure || result.exitCode !== 0) return { kind: 'failed' };
    const folder = result.stdout.replace(/^\uFEFF/u, '');
    if (!folder) return { kind: 'cancelled' };
    if (path.win32.isAbsolute(folder) && !/["\x00-\x1f\x7f]/u.test(folder))
      return { kind: 'selected', folder };
  } catch {
    // 部分桌面或策略环境无法启动系统窗口，返回固定原因并保留手动填写方式。
  }
  return { kind: 'failed' };
}
