@echo off
chcp 65001 >nul
title TikTok Bridge
cd /d "%~dp0"
echo Starting TikTok Bridge...
python tiktok_bridge.py
pause
