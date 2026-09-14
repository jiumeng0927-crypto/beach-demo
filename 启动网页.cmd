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

if not exist "node_modules\vite\bin\vite.js" (
  echo [潮汐沙岸] 首次启动，正在安装项目依赖...
  call npm ci
  if errorlevel 1 goto :failed
)

echo [潮汐沙岸] 正在生成最新网页成品...
call npm run build
if errorlevel 1 goto :failed

node "scripts\local-server.mjs" --root "dist" --port 5175 --open
if errorlevel 1 goto :failed

echo [潮汐沙岸] 网页服务已在后台运行，可关闭此窗口。
exit /b 0

:failed
echo [潮汐沙岸] 启动失败，请查看上方错误信息。
pause
exit /b 1
