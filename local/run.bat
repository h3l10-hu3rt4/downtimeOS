@echo off
REM Arranque rapido DowntimeOS (Windows)
cd /d "%~dp0"
python server\main.py %*
