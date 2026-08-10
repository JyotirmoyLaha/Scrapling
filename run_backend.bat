@echo off
title Scrapling Backend API
echo Starting Scrapling Backend API...
cd /d "%~dp0web_app\backend"

rem Call the venv interpreter directly instead of going through activate.bat.
rem python.exe resolves its own site-packages from the adjacent pyvenv.cfg, so this
rem keeps working even if the repo is moved (activate.bat hardcodes an absolute path).
if not exist "venv\Scripts\python.exe" (
    echo.
    echo ERROR: No virtualenv found at web_app\backend\venv
    echo Create it with:
    echo     python -m venv venv
    echo     venv\Scripts\python.exe -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

"venv\Scripts\python.exe" main.py
pause
