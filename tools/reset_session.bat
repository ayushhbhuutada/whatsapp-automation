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

if exist "%~dp0..\config\browser-data" (
    rd /s /q "%~dp0..\config\browser-data"
)

if defined LOCALAPPDATA (
    if exist "%LOCALAPPDATA%\WhatsAppAutomation\browser-data" (
        rd /s /q "%LOCALAPPDATA%\WhatsAppAutomation\browser-data"
    )
)

if exist "%~dp0..\uploads\qr.png" (
    del /f /q "%~dp0..\uploads\qr.png"
)

echo.
echo Session Reset Complete! Next launch will request fresh QR scan.
pause
