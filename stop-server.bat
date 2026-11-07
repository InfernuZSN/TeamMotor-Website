@echo off
title Stop TeamMotor Server

echo Stopping TeamMotor server...
taskkill /F /IM node.exe >nul 2>&1

echo TeamMotor server stopped.
timeout /t 2 >nul
exit
