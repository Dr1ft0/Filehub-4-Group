@echo off
REM ============================================
REM  脚本仙人 小组脚本共享系统 - 启动脚本
REM  后台常驻运行，日志写入 data/logs/
REM ============================================
cd /d "%~dp0"

echo 正在启动 FileHub 服务...

REM 检查是否已在运行
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /i "node.exe" >nul
if %errorlevel%==0 (
  echo [提示] 检测到 node.exe 已在运行，可能服务已启动。
  echo        如需重启，请先运行 stop.bat
)

REM 后台启动（隐藏窗口）
start "FileHub Server" /min cmd /c "node server.js >> data\server.log 2>&1"

echo.
echo FileHub 服务已后台启动！
echo   访问地址: http://<本机内网IP>:3000/
echo   查看日志: data\server.log
echo   停止服务: 运行 stop.bat
echo.
pause