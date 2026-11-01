@echo off
title TeamMotor Server Launcher
cd /d "%~dp0server"

:: Launch Node in the background with a hidden window
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'src/server.js' -WorkingDirectory '%~dp0server' -WindowStyle Hidden"

echo TeamMotor server is running in the background on http://localhost:3000
timeout /t 2 >nul
start http://localhost:3000
exit
