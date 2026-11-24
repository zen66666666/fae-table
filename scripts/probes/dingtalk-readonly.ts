// 执行钉钉只读探针，仅在终端输出脱敏摘要，原始返回保存在 .runtime。
import {
  createRunner,
  newRunDir,
  parseArguments,
  probeReadonly,
  errorType,
} from '../../packages/dingtalk/src/index.ts';

try {
  const options = parseArguments(process.argv.slice(2), 'readonly');
  const run = createRunner({ logDir: newRunDir('dingtalk-probe') });
  const { summary, exitCode } = await probeReadonly(run, options);
  console.log(JSON.stringify(summary));
  process.exitCode = exitCode;
} catch (error) {
  console.log(JSON.stringify({ errorType: errorType(error) }));
  process.exitCode = 1;
}
