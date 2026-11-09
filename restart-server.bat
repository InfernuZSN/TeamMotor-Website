@echo off
title Restart TeamMotor Server
cd /d "%~dp0server"

echo Stopping previous TeamMotor server instance...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 >nul

echo Starting TeamMotor server with latest changes...
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'src/server.js' -WorkingDirectory '%~dp0server' -WindowStyle Hidden"

echo TeamMotor server restarted on http://localhost:3000
timeout /t 2 >nul
exit
