@echo off
REM ============================================================
REM  cpolar 公网隧道一键启动（免费版，随机域名）
REM  用法：双击本文件，或命令行运行
REM  注意：免费版每次启动域名会变！启动后在本窗口找
REM   "Tunnel established at https://xxxxx.r8.cpolar.cn"
REM   把新域名同步到 miniprogram/utils/net-config.json 和
REM   miniprogram/utils/api.js 的 FALLBACK_BASE_URL 后再重新编译
REM ============================================================
echo Starting cpolar tunnel for local server port 3000 ...
echo.
echo Public URL will appear as: Tunnel established at https://xxxxx.r8.cpolar.cn
echo Keep this window open while testing. Press Ctrl+C to stop.
echo.
"C:\Program Files\cpolar\cpolar.exe" http 3000 -log stdout -log-level INFO
pause
