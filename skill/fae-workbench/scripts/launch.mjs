// 为双击入口与可选 Skill 检查 Node 版本，选择中文提示或机器可读输出。
const MINIMUM_NODE_MAJOR = 24;
const NODE_DOWNLOAD_URL = 'https://nodejs.org/zh-cn/download';
const INTERACTIVE_ARGUMENT = '--interactive';
const DINGTALK_COMMAND = 'dws';
const FAILURE_MESSAGES = {
  'invalid-arguments': '启动参数无效。',
  'background-creation-failed': 'Windows 未能创建后台进程。',
  'background-start-timeout': '等待后台启动超时。',
  'browser-open-failed': '系统未能打开默认浏览器。',
  'browser-open-timeout': '未能确认浏览器页面加载完成。请检查浏览器后重新打开。',
  'unsupported-platform': '工作台需要在 Windows 上运行。',
  'missing-system-root': '找不到 Windows 系统目录。',
  'missing-local-app-data': '找不到本机数据目录。',
  'server-stop-timeout': '等待工作台退出超时。',
  'server-unavailable': '无法连接或控制工作台后台。',
  'launcher-unavailable': '无法加载工作台，请检查解压后的文件。',
};
const RESULT_MESSAGES = {
  started: '已打开 FAE 工作台。',
  reused: 'FAE 工作台已在运行，已打开页面。',
  stopped: '已退出 FAE 工作台。',
  'not-running': 'FAE 工作台当前未运行。',
};
const MISSING_DINGTALK_MESSAGE = '未找到钉钉命令行，可在设置页查看安装提示。';
const BROWSER_SKIPPED_MESSAGE = '已按设置跳过打开浏览器。';
const args = process.argv.slice(2);
const interactiveIndex = args.indexOf(INTERACTIVE_ARGUMENT);
const isInteractive = interactiveIndex !== -1;
const currentMajor = Number(process.versions.node.split('.')[0]);

if (isInteractive) args.splice(interactiveIndex, 1);

function formatInteractiveResult(result) {
  if (result.status === 'node-too-old')
    return `请安装 Node.js ${MINIMUM_NODE_MAJOR} 或更新版本。\n下载地址 ${NODE_DOWNLOAD_URL}`;
  if (result.status === 'failed')
    return `操作失败。${FAILURE_MESSAGES[result.reason] ?? FAILURE_MESSAGES['server-unavailable']}`;
  // 自动化模式仍能启动后台，交互提示不回显它生成的一次性启动地址。
  const message = result.launchUrl ? BROWSER_SKIPPED_MESSAGE : RESULT_MESSAGES[result.status];
  return result.missing?.includes(DINGTALK_COMMAND)
    ? `${message}\n${MISSING_DINGTALK_MESSAGE}`
    : message;
}

const formatResult = isInteractive ? formatInteractiveResult : JSON.stringify;

function writeResult(result) {
  process.stdout.write(`${formatResult(result)}\n`);
}

if (!Number.isInteger(currentMajor) || currentMajor < MINIMUM_NODE_MAJOR) {
  writeResult({ status: 'node-too-old' });
  process.exitCode = 1;
} else {
  import('./launch.ts')
    .then(function (launcher) {
      return launcher.runLauncher({ args, isInteractive, formatResult });
    })
    .then(function (exitCode) {
      process.exitCode = exitCode;
    })
    .catch(function () {
      writeResult({ status: 'failed', port: 0, missing: [], reason: 'launcher-unavailable' });
      process.exitCode = 1;
    });
}
