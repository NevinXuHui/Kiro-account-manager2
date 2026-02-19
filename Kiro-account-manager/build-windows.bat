@echo off
setlocal enabledelayedexpansion

:: ========================================
::   Kiro Account Manager
::   Windows Build Script
:: ========================================

echo ========================================
echo   Kiro Account Manager
echo   Windows Build Script
echo ========================================
echo.

:: Check Node.js
echo [INFO] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found, please install Node.js first
    echo [INFO] Download: https://nodejs.org/
    pause
    exit /b 1
)
echo [INFO] Node.js version:
node --version
echo.

:: Check dependencies
echo [INFO] Checking dependencies...
if not exist "node_modules" (
    echo [WARN] Dependencies not installed, installing...
    call pnpm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencies already installed
)
echo.

:: Clean old build files
echo [INFO] Cleaning old build files...
if exist "dist" (
    rd /s /q "dist" 2>nul
    echo [INFO] Cleaned dist directory
)
if exist "out" (
    rd /s /q "out" 2>nul
    echo [INFO] Cleaned out directory
)
echo.

:: Build project
echo [INFO] Building project...
echo ========================================
call pnpm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo ========================================
echo [INFO] Build completed
echo.

:: Package Windows installer
echo [INFO] Packaging Windows installer...
echo ========================================
call pnpm run build:win
if errorlevel 1 (
    echo.
    echo [ERROR] Packaging failed
    pause
    exit /b 1
)
echo ========================================
echo.

:: Show build results
echo [SUCCESS] Build completed!
echo.
echo [INFO] Installer location:
if exist "dist" (
    dir /b "dist\*.exe" 2>nul
    echo.
    echo [INFO] Full path:
    for %%f in (dist\*.exe) do echo %%~ff
)
echo.
echo ========================================
echo   Build Complete
echo ========================================

pause
