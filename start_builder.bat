@echo off
chcp 65001 >nul
title TikTok String Builder
cd /d "%~dp0"
python tiktok_string_builder.py
if errorlevel 1 (
    echo.
    echo Application exited with error. Did you install requirements?
    echo   pip install -r requirements.txt
    pause
)
