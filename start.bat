@echo off
REM ============================================
REM  脚本仙人 小组脚本共享系统 - 启动脚本
REM  后台常驻运行，日志写入 data\server.log
REM  进程 PID 记录在 data\server.pid
REM ============================================
setlocal
cd /d "%~dp0"

echo 正在启动 FileHub 服务...

REM 确保 data 目录存在（日志、PID 文件都放这里）
if not exist "data" mkdir "data"

REM 检查是否已在运行（通过 PID 文件）
set PID_FILE=data\server.pid
if exist "%PID_FILE%" (
  set /p OLD_PID=<"%PID_FILE%"
  tasklist /FI "PID eq %OLD_PID%" 2>nul | find /i "%OLD_PID%" >nul
  if not errorlevel 1 (
    echo [提示] FileHub 服务已在运行（PID: %OLD_PID%）。
    echo        如需重启，请先运行 stop.bat
    echo.
    pause
    exit /b 0
  )
  REM PID 文件存在但进程已不存在，清理残留
  del "%PID_FILE%" >nul 2>&1
)

REM 后台启动（start /b 不弹新窗口，继承当前工作目录）
start /b "" cmd /c "node server.js >> data\server.log 2>&1"

REM 等待进程启动并写入 PID 文件
set /a WAIT=0
:waitloop
if exist "%PID_FILE%" goto pidok
set /a WAIT+=1
if %WAIT% GEQ 20 goto pidtimeout
ping -n 2 127.0.0.1 >nul
goto waitloop

:pidtimeout
echo [警告] 未能获取进程 PID，请检查 data\server.log 确认启动是否成功。
goto done

:pidok
set /p NEW_PID=<"%PID_FILE%"
echo.
echo FileHub 服务已后台启动！
echo   进程 PID: %NEW_PID%
echo   访问地址: http://<本机内网IP>:3000/
echo   查看日志: data\server.log
echo   停止服务: 运行 stop.bat
echo.

:done
pause
endlocal