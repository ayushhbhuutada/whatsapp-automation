@echo off
title WhatsApp Automation Launcher
color 0A

echo ================================================
echo     WhatsApp Automation - Starting Up...
echo ================================================
echo.

echo [1/3] Starting Backend Server (Port 5000)...
start "WhatsApp Backend" cmd /k "cd /d %~dp0backend && npm run dev"

echo [2/3] Starting Frontend Server (Port 5173)...
start "WhatsApp Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo [3/3] Waiting for servers to initialize...
timeout /t 5 /nobreak >nul

echo.
echo Opening Dashboard in Browser...
start http://localhost:5173

echo.
echo ================================================
echo  Both servers are running!
echo  Backend:  http://localhost:5000
echo  Frontend: http://localhost:5173
echo ================================================
echo.
echo  You can close this window. The two server
echo  windows must stay open while using the app.
echo ================================================
pause
