@echo off
chcp 65001 >nul
title 训练馆后端服务 (端口 3000)
cd /d "%~dp0"
echo 综合训练馆后端服务启动中... (端口 3000)
echo 关闭此窗口将停止服务。
node index.js
pause
