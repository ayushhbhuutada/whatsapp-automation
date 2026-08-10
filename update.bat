@echo off
title WhatsApp Automation - Update Script
color 0A
echo ================================================
echo     WhatsApp Automation - Pulling Latest Updates
echo ================================================
echo.

git pull origin main

echo.
echo ================================================
echo  Update Complete! Your app is now up to date.
echo  Double-click 'start.bat' to launch the bot.
echo ================================================
pause
