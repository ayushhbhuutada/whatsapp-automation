@echo off
title WhatsApp Automation - Stop All Servers
color 0C
echo ================================================
echo     Stopping active Node / Server processes...
echo ================================================
echo.

taskkill /F /IM node.exe /T 2>nul
if %errorlevel% equ 0 (
    echo Successfully stopped server processes.
) else (
    echo No running server processes found.
)

echo.
echo ================================================
echo  Servers stopped cleanly. You can now run start.bat
echo ================================================
pause
