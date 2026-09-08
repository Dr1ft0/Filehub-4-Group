@echo off
REM ============================================
REM  FileHub 小组文件共享系统 - 停止脚本
REM ============================================
cd /d "%~dp0"

echo 正在停止 FileHub 服务...

REM 结束所有 node 进程（FileHub 服务）
taskkill /F /IM node.exe 2>nul

echo.
echo FileHub 服务已停止。
pause