@echo off
title WhatsApp Automation Suite
color 0A

echo ================================================
echo     WhatsApp Automation Suite - Launching...
echo ================================================
echo.

:: 1. Auto-Detect & Install Backend Dependencies if missing
if not exist "%~dp0backend\node_modules" (
    echo [First-Time Setup] Installing backend packages...
    cd /d "%~dp0backend"
    call npm install
    call npx playwright install chromium
)

:: 2. Auto-Detect & Install Frontend Dependencies if missing
if not exist "%~dp0frontend\node_modules" (
    echo [First-Time Setup] Installing frontend packages...
    cd /d "%~dp0frontend"
    call npm install
)

:: 3. Terminate any stale background node server processes to prevent port conflicts
echo [1/2] Freeing server ports...
taskkill /F /IM node.exe /T 2>nul

:: 4. Start Backend Server (Port 5000)
echo [2/2] Starting application servers...
start "WhatsApp Backend" /min cmd /c "cd /d "%~dp0backend" && npm run dev"

:: 5. Start Frontend Server (Port 5173)
start "WhatsApp Frontend" /min cmd /c "cd /d "%~dp0frontend" && npm run dev"

:: 6. Wait for servers to initialize
timeout /t 4 /nobreak >nul

:: 7. Open Dashboard in Browser
echo.
echo Opening Dashboard in Browser...
start http://localhost:5173

echo.
echo ================================================
echo  WhatsApp Automation is active!
echo  Dashboard URL: http://localhost:5173
echo ================================================
echo.
echo  Keep this window open while using the app.
echo  Press any key to stop the servers and exit.
echo ================================================
pause >nul

echo.
echo Stopping application servers...
taskkill /F /IM node.exe /T 2>nul
echo Done!
