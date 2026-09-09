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

set PID_FILE=data\server.pid

REM ---- 检查是否已在运行（通过 PID 文件 + 进程存活校验）----
if not exist "%PID_FILE%" goto launch

set /p OLD_PID=<"%PID_FILE%"
powershell -NoProfile -Command "if (Get-Process -Id %OLD_PID% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  REM PID 文件存在但进程已不存在，清理残留后继续启动
  del "%PID_FILE%" >nul 2>&1
  goto launch
)

echo [提示] FileHub 服务已在运行（PID: %OLD_PID%）。
echo        如需重启，请先运行 stop.bat
echo.
pause
exit /b 0

:launch
REM ---- 放行防火墙 3000 端口（需管理员权限，失败则忽略）----
netsh advfirewall firewall add rule name="FileHub-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1

REM ---- 启动：完全分离的后台进程（无窗口），关闭本窗口不影响服务 ----
powershell -NoProfile -Command "Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"

REM ---- 等待进程启动并写入 PID 文件 ----
set /a WAIT=0
:waitloop
if exist "%PID_FILE%" goto pidok
set /a WAIT+=1
if %WAIT% GEQ 30 goto pidtimeout
ping -n 2 127.0.0.1 >nul
goto waitloop

:pidtimeout
echo [警告] 未能获取进程 PID，请检查 data\server.log 确认启动是否成功。
goto done

:pidok
set /p NEW_PID=<"%PID_FILE%"

REM ---- 自动检测当前内网 IP（DHCP 动态分配，每次启动实时获取）----
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-lan-ip.ps1"') do set LAN_IP=%%i
if not defined LAN_IP set LAN_IP=127.0.0.1

echo.
echo FileHub 服务已后台启动！
echo   进程 PID: %NEW_PID%
echo   访问地址: http://%LAN_IP%:3000/
echo   查看日志: data\server.log（及 data\logs\ 按天日志）
echo   停止服务: 运行 stop.bat
echo.

:done
pause
endlocal