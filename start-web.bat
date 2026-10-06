@echo off
chcp 65001 >nul
title SubtitleProofreader - Web
cd /d "%~dp0"

REM ============================================================
REM   SubtitleProofreader - Web version launcher
REM   Requires Node.js 18+. Run start-web.bat (double-click).
REM ============================================================

echo.
echo   SubtitleProofreader - Web Version
echo   -------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Node.js not found in PATH.
    echo          Install Node.js 18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version') do set NODEV=%%v
echo   Node.js %NODEV%

if not exist "web\index.html" (
    echo   [ERROR] web\index.html not found.
    echo          Wrong directory: %CD%
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo   [NOTE] First run: installing dependencies...
    call npm install --no-audit --no-fund
    echo.
)

echo   Starting server at http://127.0.0.1:5178/
echo   Opening browser...
echo.
echo   Keep this window open while using the app.
echo   Press Ctrl+C to stop.
echo.

start "" http://127.0.0.1:5178/
node scripts\serve-web.js

echo.
echo   Server stopped.
pause