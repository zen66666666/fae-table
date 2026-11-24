---
name: fae-workbench
description: 可选：在 Codex 里打开或退出 Windows 本机的 FAE 工作台。用户说“打开 FAE 工作台”“处理技术支持单”或“FAE workbench”时使用。
---

# 可选：在 Codex 里打开工作台

解压后可双击“启动 FAE 工作台.cmd”打开本机网页。已安装此 Skill 的用户也可以在 Codex 中调用同一个启动器。首次使用时在网页配置并测试自己的 AI 接口，然后完成钉钉扫码授权与账号选择。AI 接口已配置且钉钉就绪时，网页直接打开三栏工作台。

## 打开工作台

1. 根据本文件的实际绝对路径确定 Skill 目录，运行：

   ```text
   node "<本 SKILL.md 所在目录>/scripts/launch.mjs"
   ```

   安装包已包含构建好的网页。工作台后台在 Windows 本机运行，启动器可从任意工作目录调用。

2. 读取启动器输出的单行 JSON，用简短中文告知用户结果。`started` 表示后台已启动且页面已连接，`reused` 表示已有后台且页面已连接。`failed` 时根据 `reason` 说明失败原因。`browser-open-failed` 表示系统未能打开默认浏览器，`browser-open-timeout` 表示打开请求已发送，页面加载未获确认。`node-too-old` 表示需要安装 Node.js 24 或更新版本。

3. `missing` 中出现 `dws` 时，网页仍可打开。告知用户钉钉命令行的安装命令 `npm install -g dingtalk-workspace-cli`。用户同意安装后才执行该命令。

4. 引导用户在网页填写接口地址、API Key 和模型名称并测试连接，然后本人完成钉钉扫码授权。API Key 由用户直接填入本机页面。

普通模式输出安全状态。`FAE_NO_BROWSER=1` 供自动化验收使用，跳过浏览器打开和页面连接确认，输出中包含仅供本机使用的临时启动地址。不要转述其中的启动码。

## 退出工作台

用户可以双击“退出 FAE 工作台.cmd”。在 Codex 收到“退出工作台”请求时运行：

```text
node "<本 SKILL.md 所在目录>/scripts/launch.mjs" --stop
```

`stopped` 表示已退出，`not-running` 表示没有运行中的工作台。不要按进程名称批量终止 Node、Codex、钉钉或浏览器。

## 操作边界

- 不要自己运行任何钉钉审批、评论或发消息命令。网页提供只读单据查看。
- 不要读取、列举或向模型提供工作台数据目录里的内容，包括 `%LOCALAPPDATA%/FAE-Workbench` 和自定义 `FAE_DATA_DIR`。实例锁和配置的必要读写由工作台程序内部完成。
- 不读取或输出 token、账号凭据、会话 cookie、原始 CLI 输出；只解释启动器提供的脱敏状态。
