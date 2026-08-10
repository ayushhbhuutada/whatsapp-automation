@echo off
title WhatsApp Automation Suite
color 0A

echo ================================================
echo     WhatsApp Automation Suite - Launching...
echo ================================================
echo.

:: 0. Auto-Check & Sync Latest Updates from GitHub
if exist "%~dp0.git" (
    echo [1/3] Syncing latest code updates from GitHub...
    git fetch origin main >nul 2>&1
    git reset --hard origin/main >nul 2>&1
    echo       Repository synced to latest commit.
) else (
    echo [1/3] Running from extracted ZIP folder.
)
echo.

:: 1. Clean up obsolete native C++ database packages if they exist
if exist "%~dp0backend\node_modules\sqlite3" (
    echo [Cleanup] Removing obsolete sqlite3 package...
    rd /s /q "%~dp0backend\node_modules\sqlite3" 2>nul
)
if exist "%~dp0backend\node_modules\better-sqlite3" (
    echo [Cleanup] Removing obsolete better-sqlite3 package...
    rd /s /q "%~dp0backend\node_modules\better-sqlite3" 2>nul
)

:: 2. Auto-Detect & Install Backend Dependencies if missing
if not exist "%~dp0backend\node_modules" (
    echo [First-Time Setup] Installing backend packages...
    cd /d "%~dp0backend"
    call npm install
    call npx playwright install chromium
)

:: 3. Auto-Detect & Install Frontend Dependencies if missing
if not exist "%~dp0frontend\node_modules" (
    echo [First-Time Setup] Installing frontend packages...
    cd /d "%~dp0frontend"
    call npm install
)

:: 4. Terminate any stale background node server processes to prevent port conflicts
echo [2/3] Preparing server ports...
taskkill /F /IM node.exe /T 2>nul

:: 5. Start Backend Server (Port 5000)
echo [3/3] Starting Backend Server (Port 5000)...
start "WhatsApp Backend (Port 5000)" cmd /k "cd /d "%~dp0backend" && npm run dev"

:: 6. Start Frontend Server (Port 5173)
echo       Starting Frontend Server (Port 5173)...
start "WhatsApp Frontend (Port 5173)" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: 7. Wait for servers to initialize
timeout /t 5 /nobreak >nul

:: 8. Open Dashboard in Browser
echo.
echo Opening Dashboard in Browser...
start http://localhost:5173

echo.
echo ================================================
echo  WhatsApp Automation is active!
echo  Dashboard URL: http://localhost:5173
echo ================================================
echo.
echo  Keep the server windows open while using the app.
echo  Press any key to close this window.
echo ================================================
pause >nul
