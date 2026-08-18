@echo off
title WhatsApp Automation Pro - Local Mode
color 0A
echo =====================================================================
echo           WhatsApp Automation Pro - Local Edition
echo =====================================================================
echo.
echo [1/2] Starting background automation engine...
echo [2/2] Launching your browser at http://localhost:5000 ...
echo.
timeout /t 2 /nobreak >nul
start "" http://localhost:5000
node backend/server.js
pause
