@echo off
REM ============================================
REM  FileHub 小组文件共享系统 - 停止脚本
REM  通过 PID 文件精确定位 FileHub 进程，
REM  不会误杀其他 node 进程
REM ============================================
setlocal
cd /d "%~dp0"

echo 正在停止 FileHub 服务...

set PID_FILE=data\server.pid

REM ---- 检查 PID 文件是否存在 ----
if not exist "%PID_FILE%" (
  echo [提示] 未找到 PID 文件（data\server.pid），服务可能未启动。
  echo        若服务仍在运行，请手动结束对应的 node 进程。
  echo.
  pause
  exit /b 0
)

REM ---- 读取 PID ----
set /p PID=<"%PID_FILE%"

REM ---- 校验 PID 是否为数字 ----
echo %PID%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo [错误] PID 文件内容无效: %PID%
  del "%PID_FILE%" >nul 2>&1
  echo        已清理无效的 PID 文件。
  echo.
  pause
  exit /b 1
)

REM ---- 结束 FileHub 进程（仅该 PID，不影响其他 node 进程）----
powershell -NoProfile -Command "Stop-Process -Id %PID% -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 500; if (Get-Process -Id %PID% -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo [错误] 无法结束进程 PID %PID%，请以管理员身份运行或检查权限。
  echo.
  pause
  exit /b 1
)

REM ---- 清理 PID 文件 ----
del "%PID_FILE%" >nul 2>&1

echo.
echo FileHub 服务已停止（PID %PID%）。
echo.
pause
endlocal
