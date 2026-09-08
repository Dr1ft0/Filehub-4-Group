@echo off
REM ============================================
REM  FileHub 小组文件共享系统 - 备份脚本
REM  备份 data/ 目录（数据库 + 文件 + 日志）
REM ============================================
cd /d "%~dp0"

set BACKUP_DIR=data\backup
set TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set DEST=%BACKUP_DIR%\filehub_backup_%TIMESTAMP%

echo 正在备份 FileHub 数据到 %DEST% ...

REM 创建备份目录
if not exist "%DEST%" mkdir "%DEST%"

REM 复制数据库、文件、日志
xcopy /E /I /Y data\filehub.db "%DEST%\" >nul 2>&1
xcopy /E /I /Y data\uploads "%DEST%\uploads\" >nul 2>&1
xcopy /E /I /Y data\audit.log "%DEST%\" >nul 2>&1

echo.
echo 备份完成！
echo   备份位置: %DEST%
echo.
pause