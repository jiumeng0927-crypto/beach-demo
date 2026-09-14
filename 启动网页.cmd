@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [潮汐沙岸] 未检测到 Node.js 20.19 或更高版本。
  echo 请安装 Node.js 后重新双击本文件。
  pause
  exit /b 1
)

node "scripts\local-server.mjs" --root "." --port 5175 --open
if errorlevel 1 (
  echo [潮汐沙岸] 启动失败，请查看 .tideline-server.log。
  pause
  exit /b 1
)

echo [潮汐沙岸] 网页服务已在后台运行，可关闭此窗口。
exit /b 0
