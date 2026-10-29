@echo off
REM Push to GitHub - Windows Batch Script
REM Usage: Right-click and "Run as administrator" or double-click

setlocal enabledelayedexpansion

echo.
echo ================================================================
echo     Options Strategy App - Push to GitHub
echo ================================================================
echo.

REM Check if git is installed
where git >nul 2>nul
if !errorlevel! neq 0 (
    echo [ERROR] Git not found. Please install Git from https://git-scm.com/
    pause
    exit /b 1
)

REM Check if in app directory
if not exist "backend" (
    echo [ERROR] Not in app root directory. Please run from Options Strategy App folder.
    pause
    exit /b 1
)

REM Initialize git if needed
if not exist ".git" (
    echo Initializing git repository...
    call git init
)

REM Get GitHub info
set /p GITHUB_USERNAME="Enter your GitHub username: "
set /p REPO_NAME="Enter repository name (default: options-strategy-app): "
if "!REPO_NAME!"=="" set REPO_NAME=options-strategy-app

set REPO_URL=https://github.com/!GITHUB_USERNAME!/!REPO_NAME!.git

echo.
echo Using repository: !REPO_URL!
echo.

REM Add remote
echo Adding remote origin...
for /f "delims=" %%A in ('git remote get-url origin 2^>nul') do set EXISTING_REMOTE=%%A

if not "!EXISTING_REMOTE!"=="" (
    echo Removing existing remote...
    call git remote remove origin
)

call git remote add origin !REPO_URL!

REM Add files
echo.
echo Staging files...
call git add .

if !errorlevel! neq 0 (
    echo [ERROR] Failed to stage files
    pause
    exit /b 1
)

REM Commit
set /p COMMIT_MSG="Enter commit message (default: Initial commit): "
if "!COMMIT_MSG!"=="" set COMMIT_MSG=Initial commit - Options Strategy App

echo.
echo Committing...
call git commit -m "!COMMIT_MSG!"

if !errorlevel! neq 0 (
    echo [WARNING] Commit may have failed or nothing to commit
)

REM Push
echo.
echo Pushing to GitHub...
call git branch -M main
call git push -u origin main

if !errorlevel! equ 0 (
    echo.
    echo [SUCCESS] Successfully pushed to GitHub!
    echo Repository: !REPO_URL!
    echo.
    echo Next step on VPS:
    echo   ssh root@70.36.114.244
    echo   cd /var/www/options-strategy-app
    echo   git clone !REPO_URL! .
    echo.
) else (
    echo.
    echo [ERROR] Failed to push to GitHub
    echo Please check your credentials and internet connection
    echo.
)

pause
