// 运行有界审批事件探针，标准输出只包含脱敏摘要。
import {
  createRunner,
  newRunDir,
  parseArguments,
  identify,
  probeEvents,
  emptyEventSummary,
  errorType,
} from '../../packages/dingtalk/src/index.ts';

try {
  const options = parseArguments(process.argv.slice(2), 'event');
  const logDir = newRunDir('dingtalk-event');
  const run = createRunner({ logDir });
  const identity = await identify(run, options.profile);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const result = await probeEvents({
      run,
      profile: identity.profile,
      seconds: options.seconds,
      logDir,
      signal: controller.signal,
    });
    console.log(JSON.stringify(result.summary));
    process.exitCode = result.exitCode;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
} catch (error) {
  // 身份、配置等前置步骤失败时只投影白名单类别，不输出异常正文。
  console.log(JSON.stringify({ ...emptyEventSummary(), errorType: errorType(error) }));
  process.exitCode = 1;
}
