@echo off
chcp 65001 >nul
title 综合训练馆订课系统 - 本地服务一键启动
echo ============================================
echo   综合训练馆订课系统 本地服务一键启动
echo ============================================
echo.

cd /d "%~dp0"

REM 1. 探测本机局域网 IP（仅用于提示；后端启动时会自动写入前端配置）
echo [1/2] 探测本机局域网 IP...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set "IP=%%a"
    goto :ipfound
)
:ipfound
set "IP=%IP: =%"
if "%IP%"=="" (
    echo    未探测到 IPv4，使用 localhost
    set "IP=127.0.0.1"
)
echo    本机 IP: %IP%

REM 2. 检查并启动后端（启动时自动探测 IP 并写入小程序配置，无需手动改 api.js）
echo [2/2] 检查后端服务...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { Write-Output 'running' } } catch { Write-Output 'stopped' }" > "%TEMP%\gym_check.txt"
set /p SRV=<"%TEMP%\gym_check.txt"
del "%TEMP%\gym_check.txt"

if "%SRV%"=="running" (
    echo    后端已在运行 ✓
) else (
    echo    后端未运行，正在启动...
    start "gym-server" /min "%~dp0server\start-server.bat"
    echo    已启动（最小化窗口），等待就绪...
    timeout /t 2 /nobreak >nul
)

echo.
echo ============================================
echo   完成！请在微信开发者工具中重新编译小程序
echo   后端地址: http://%IP%:3000
echo   （IP 变化已自动适配，无需再手动修改 api.js）
echo ============================================
pause
