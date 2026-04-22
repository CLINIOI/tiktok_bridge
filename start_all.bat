@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting TikTok Bridge in background...
start "TikTok Bridge" cmd /k "python tiktok_bridge.py"
timeout /t 2 /nobreak >nul
echo Starting String Builder...
start "TikTok String Builder" cmd /k "python tiktok_string_builder.py"
echo.
echo Both components started. Close this window if you want.
timeout /t 3 /nobreak >nul
