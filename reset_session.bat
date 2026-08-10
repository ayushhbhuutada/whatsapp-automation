@echo off
title WhatsApp Automation - Reset Session
color 0C
echo ================================================
echo     WhatsApp Automation - Reset Session
echo ================================================
echo.
echo Warning: This will log out WhatsApp Web and clear
echo all saved browser session data on THIS computer.
echo.
pause

echo.
echo Cleaning up session data...

if exist "%~dp0config\browser-data" (
    echo Removing local config\browser-data...
    rd /s /q "%~dp0config\browser-data"
)

if defined LOCALAPPDATA (
    if exist "%LOCALAPPDATA%\WhatsAppAutomation\browser-data" (
        echo Removing AppData\Local browser session...
        rd /s /q "%LOCALAPPDATA%\WhatsAppAutomation\browser-data"
    )
)

if exist "%~dp0uploads\qr.png" (
    del /f /q "%~dp0uploads\qr.png"
)

echo.
echo ================================================
echo  Session Reset Complete!
echo  Next time you run start.bat, it will ask for 
echo  a fresh QR Code scan.
echo ================================================
pause
