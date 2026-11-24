@echo off
chcp 65001 >nul
rem 供两个双击入口调用，检查 Node 是否可用，并在操作失败后保留窗口。
setlocal DisableDelayedExpansion
set "FAE_LAUNCH_NODE_EXECUTABLE=node.exe"
set "FAE_LAUNCH_NODE_DOWNLOAD_URL=https://nodejs.org/zh-cn/download"

rem 1. 检查 Node 是否存在；2. 交给启动器；3. 失败时等待按键。
rem 1. 使用系统命令查找 Node，缺失时直接提供下载地址。
"%SystemRoot%\System32\where.exe" %FAE_LAUNCH_NODE_EXECUTABLE% >nul 2>&1
if errorlevel 1 goto node-missing

rem 2. Node 14 之前无法可靠加载此入口，其他版本的最低要求由启动器检查。
%FAE_LAUNCH_NODE_EXECUTABLE% -e "process.exit(Number(process.versions.node.split('.')[0]) >= 14 ? 0 : 1)" >nul 2>&1
if errorlevel 1 goto node-legacy
%FAE_LAUNCH_NODE_EXECUTABLE% "%~dp0launch.mjs" --interactive %*
set "FAE_LAUNCH_EXIT_CODE=%errorlevel%"
if not "%FAE_LAUNCH_EXIT_CODE%"=="0" goto wait-for-key
exit /b 0

:node-missing
echo 未找到 Node.js。请安装后再打开工作台。
goto download-node

:node-legacy
echo Node.js 版本太低。请安装更新版本后再打开工作台。

:download-node
echo 下载地址 %FAE_LAUNCH_NODE_DOWNLOAD_URL%
set "FAE_LAUNCH_EXIT_CODE=1"

:wait-for-key
rem 3. 同时保留 Node 检查和启动器失败的提示，双击时有时间阅读。
echo 按任意键关闭窗口。
pause >nul
exit /b %FAE_LAUNCH_EXIT_CODE%
