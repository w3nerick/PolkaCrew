@echo off
cd /d %~dp0
where py >nul 2>&1
if %errorlevel%==0 (
  py relay_server.py
) else (
  python relay_server.py
)
pause
