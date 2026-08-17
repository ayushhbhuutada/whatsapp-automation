@echo off
title WhatsApp Automation Pro - Local Mode
echo ========================================================
echo   Starting WhatsApp Automation Pro Local Server...
echo ========================================================
echo.
echo Opening app in your browser at http://localhost:5000 ...
timeout /t 2 /nobreak >nul
start "" http://localhost:5000
node backend/server.js
pause
