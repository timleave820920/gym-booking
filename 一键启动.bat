@echo off
chcp 65001 >nul
title 综合训练馆订课系统 - 本地服务一键启动
echo ============================================
echo   综合训练馆订课系统 本地服务一键启动
echo ============================================
echo.

cd /d "%~dp0"

REM 1. 探测本机局域网 IP
echo [1/3] 探测本机局域网 IP...
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

REM 2. 更新小程序 BASE_URL（自动适配 IP 变化）
echo [2/3] 同步前端 BASE_URL...
powershell -NoProfile -Command "(Get-Content 'miniprogram\utils\api.js' -Raw -Encoding UTF8) -replace \"LOCAL_BASE_URL = 'http://[^']+'\", \"LOCAL_BASE_URL = 'http://%IP%:3000'\" | Set-Content 'miniprogram\utils\api.js' -Encoding UTF8"
echo    已写入 http://%IP%:3000

REM 3. 检查并启动后端
echo [3/3] 检查后端服务...
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
echo ============================================
pause
