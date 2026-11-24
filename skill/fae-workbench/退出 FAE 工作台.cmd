@echo off
rem 双击入口，使用共用交互脚本退出 FAE 工作台。
setlocal DisableDelayedExpansion
"%~dp0scripts\launch-interactive.cmd" --stop
