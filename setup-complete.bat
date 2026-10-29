@echo off
REM Trading Platform - Automated Setup (Windows)

setlocal enabledelayedexpansion

echo.
echo ================================================================
echo  Trading Platform - Setup & Installation
echo ================================================================
echo.

REM Check Node.js
where node >nul 2>nul
if !errorlevel! neq 0 (
    echo [ERROR] Node.js not found. Please install from https://nodejs.org/
    exit /b 1
)
echo [OK] Node.js installed

REM Check npm
where npm >nul 2>nul
if !errorlevel! neq 0 (
    echo [ERROR] npm not found.
    exit /b 1
)
echo [OK] npm installed

REM Check PostgreSQL
where psql >nul 2>nul
if !errorlevel! neq 0 (
    echo [ERROR] PostgreSQL not found. Please install from https://www.postgresql.org/download/windows/
    exit /b 1
)
echo [OK] PostgreSQL installed

echo.
echo Setting up backend...
cd backend

REM Create .env if not exists
if not exist ".env" (
    echo Creating .env file from template...
    copy .env.example .env
    echo [WARNING] Please update .env with your settings
    echo   - Finnhub API Key: https://finnhub.io/register
    echo   - Database password if different from default
    pause
)

REM Install dependencies
echo.
echo Installing npm dependencies...
call npm install

REM Run migrations
echo.
echo Running database migrations...
call npm run migrations

echo.
echo ================================================================
echo  Setup Complete!
echo ================================================================
echo.
echo Next steps:
echo 1. Start Redis (optional):
echo    Use Docker or Windows Redis
echo.
echo 2. Start backend:
echo    npm run dev
echo.
echo 3. Run tests (in new terminal):
echo    node test-api.js
echo.
echo 4. Start frontend:
echo    cd frontend
echo    npm install
echo    npm start
echo.
pause
