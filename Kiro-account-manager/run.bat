@echo off
chcp 65001 >nul
title Kiro Account Manager - Development Server

echo ========================================
echo   Kiro Account Manager
echo   Development Environment
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Display Node.js version
echo [INFO] Node.js version:
node --version
echo.

:: Check if node_modules exists
if not exist "node_modules\" (
    echo [INFO] Dependencies not found. Installing...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] Failed to install dependencies!
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [SUCCESS] Dependencies installed successfully!
    echo.
) else (
    echo [INFO] Dependencies already installed.
    echo.
)

:: Start development server
echo [INFO] Starting development server...
echo.
echo Press Ctrl+C to stop the server
echo ========================================
echo.

call npm run dev

:: If the server stops
echo.
echo [INFO] Development server stopped.
pause
