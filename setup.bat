@echo off
title WhatsApp Automation - Setup Script
color 0B
echo ================================================
echo     WhatsApp Automation - Installing Dependencies
echo ================================================
echo.

echo [1/3] Installing Backend Dependencies...
cd /d %~dp0backend
call npm install

echo.
echo [2/3] Installing Playwright Browser...
call npx playwright install chromium

echo.
echo [3/3] Installing Frontend Dependencies...
cd /d %~dp0frontend
call npm install

echo.
echo ================================================
echo  Setup Complete! 
echo  Double-click 'start.bat' to launch the bot.
echo ================================================
pause
