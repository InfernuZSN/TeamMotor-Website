@echo off
title Restart TeamMotor Server

echo Stopping active TeamMotor server...
taskkill /F /IM node.exe >nul 2>&1

echo Starting TeamMotor server with latest changes...
cd /d "%~dp0server"
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'src/server.js' -WorkingDirectory '%~dp0server' -WindowStyle Hidden"

echo TeamMotor server restarted on http://localhost:3000
timeout /t 2 >nul
exit
