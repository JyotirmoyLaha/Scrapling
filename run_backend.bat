@echo off
title Scrapling Backend API
echo Starting Scrapling Backend API...
cd web_app\backend
call .\venv\Scripts\activate
python main.py
pause
