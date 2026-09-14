@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 exit /b 1
node "scripts\local-server.mjs" --stop
timeout /t 2 /nobreak >nul
