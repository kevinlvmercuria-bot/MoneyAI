@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo 未找到 Node.js，请先安装项目要求的 Node.js。
    pause
    exit /b 1
)
node "scripts\reset-password.js"
set "reset_exit=%errorlevel%"
echo.
pause
exit /b %reset_exit%
