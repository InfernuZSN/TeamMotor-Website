@echo off
title Stop TeamMotor Server
taskkill /F /IM node.exe >nul 2>&1
echo TeamMotor background server stopped.
timeout /t 2 >nul
exit
