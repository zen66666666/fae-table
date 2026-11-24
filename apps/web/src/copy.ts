// 集中定义连接准备页文案与状态展示，由卡片和请求层复用。
import type { ConnectionReason, ConnectionState } from '../../../packages/core/src/index.ts';
import { AI_COPY } from './ai-copy.ts';

/** 用户可理解的状态名称，与 core 中的连接状态一一对应。 */
export const STATE_LABELS: Record<ConnectionState, string> = {
  unchecked: '未检查',
  checking: '检查中',
  ready: '可用',
  'action-required': '需要处理',
  failed: '失败',
};

/** 错误类别及下一步建议；只展示固定文案，避免泄露原始错误输出。 */
export const REASON_DETAILS: Record<ConnectionReason, { label: string; nextStep: string }> = {
  none: { label: '连接正常', nextStep: '连接已准备就绪。' },
  'not-installed': { label: '未找到程序', nextStep: '请先安装对应的 CLI，再重新检查连接。' },
  'login-required': { label: '尚未登录', nextStep: '请完成账号登录，再重新检查连接。' },
  'profile-required': { label: '需要选择账号', nextStep: '请选择本次工作使用的钉钉账号。' },
  'profile-invalid': { label: '账号不可用', nextStep: '请从当前账号列表重新选择，或重新登录。' },
  'folder-required': { label: '尚未设置目录', nextStep: '填写本机产品资料文件夹的完整路径。' },
  'folder-invalid': {
    label: '目录不可用',
    nextStep: '请确认路径指向本机文件夹，并检查是否输错路径或指向了文件。',
  },
  'folder-missing': {
    label: '文件夹不存在了。',
    nextStep: '点“保存并进入工作台”会按原路径重新创建，也可以改成别的文件夹。',
  },
  'folder-not-allowed': {
    label: '这个位置不能作为资料文件夹',
    nextStep: '请选择本机其他文件夹，避开磁盘根目录和系统目录。',
  },
  'folder-parent-missing': {
    label: '上级文件夹不存在',
    nextStep: '请先创建上级文件夹，或选择已有的本机文件夹。',
  },
  'folder-not-writable': {
    label: '资料文件夹不可写',
    nextStep: '请检查写入权限，或选择当前用户可写入的本机文件夹。',
  },
  'folder-disk-full': {
    label: '磁盘空间不足',
    nextStep: '请释放磁盘空间，或选择其他磁盘上的本机文件夹后重试。',
  },
  permission: { label: '访问权限不足', nextStep: '请检查账号或文件夹访问权限后重试。' },
  'session-expired': {
    label: '会话已失效：请重新打开工作台',
    nextStep: '当前页面的会话已结束，请从启动入口重新打开。',
  },
  timeout: { label: '操作超时', nextStep: '请检查网络和授权页面，再重新尝试。' },
  process: { label: '程序运行失败', nextStep: '请确认对应 CLI 可以正常启动，再重新检查。' },
  protocol: { label: '响应格式异常', nextStep: '请确认 CLI 版本受支持，再重新检查。' },
  configuration: { label: '配置不可用', nextStep: '请检查本机程序路径和运行目录后重试。' },
  'key-required': { label: '需要填写 API Key', nextStep: AI_COPY.changedServer },
  'model-selection-required': { label: '需要选择模型', nextStep: '请获取模型列表并选择模型。' },
  'model-test-required': { label: '需要测试模型', nextStep: '请重新测试连接后保存。' },
  'ai-answering': {
    label: 'AI 正在回答，暂时无法修改模型',
    nextStep: '请等待回答结束或停止后再试。',
  },
  'ai-already-answering': {
    label: '本单已有回答正在进行',
    nextStep: '请等待当前回答结束，或停止后再提问。',
  },
  unknown: { label: '暂时无法连接', nextStep: '请重新检查；若工作台已退出，请重新打开。' },
  'login-in-progress': { label: '正在等待授权', nextStep: '请在已打开的钉钉授权页面完成扫码。' },
  'login-failed': { label: '授权未完成', nextStep: '请重新打开授权页面，并在页面内完成登录。' },
};

/** 页面及交互控件的统一中文文案。 */
export const COPY = {
  brand: 'FAE 工作台',
  brandMark: 'F',
  aiShort: 'AI',
  statusSeparator: ' · ',
  setup: '首次设置',
  settings: '连接设置',
  setupSteps: '设置步骤',
  nextStep: '下一步',
  previousStep: '上一步',
  resumeSetup: '返回首次设置',
  setupCompleted: '已完成',
  refresh: '刷新状态',
  refreshing: '正在检查…',
  shutdown: '退出工作台',
  shuttingDown: '正在退出…',
  stoppedTitle: '工作台已退出',
  stoppedDescription: '本机服务已停止，你可以关闭此页面。',
  dingtalk: '钉钉',
  dingtalkStep: '钉钉授权',
  dingtalkDescription: '使用自己的钉钉身份，连接日常工作。',
  dingtalkAccountUnknown: '账号名未提供',
  formatDingtalkAccount: (organization: string, account: string): string =>
    `已登录：${organization} · ${account}`,
  dingtalkWaiting: '请在打开的钉钉授权页扫码。完成后，连接状态会自动刷新。',
  login: '登录钉钉',
  relogin: '重新登录',
  loggingIn: '等待扫码授权…',
  profile: '工作账号',
  chooseProfile: '请选择账号',
  saveProfile: '使用此账号',
  saving: '正在保存…',
  catalog: '产品资料',
  catalogDescription:
    '选择存放产品手册和技术资料的本机文件夹。工作台从官网下载的手册会保存在这里。',
  catalogLabel: '资料文件夹',
  catalogPlaceholder: '例如：D:\\产品资料',
  pickFolder: '选择文件夹…',
  pickingFolder: '正在选择…',
  folderPickCancelled: '已取消',
  folderPickBusy: '已有选择窗口，请先完成或关闭它。',
  folderPickFailed: '无法打开文件夹选择窗口，可以手动填写路径。',
  saveFolder: '保存资料目录',
  saveFolderAndEnter: '保存并进入工作台',
  pdfCount: '份 PDF 可供后续使用',
  scannedEntries: '扫描条目',
  formatScannedEntryLimit: (limit: number): string => `超过 ${limit} 个`,
  pdfCountLimited: 'PDF 数量仅统计了本次扫描范围。',
  unchecked: '正在准备连接检查…',
} as const;
