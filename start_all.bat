@echo off
start "Bridge" cmd /k "python tiktok_bridge.py"
timeout /t 2
start "Builder" cmd /k "python tiktok_string_builder.py"
