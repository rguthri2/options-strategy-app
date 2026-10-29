@echo off
REM Trading Platform - API Test Suite (Windows)
REM Test all endpoints automatically

setlocal enabledelayedexpansion

set "BASE_URL=http://localhost:5000/api"
set "TESTS_PASSED=0"
set "TESTS_FAILED=0"

echo.
echo ================================================================
echo     Trading Platform - API Test Suite
echo ================================================================
echo.

REM Test 1: Health Check
echo Testing: Health check...
curl -s "%BASE_URL%/health" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Health check
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Health check
    set /a TESTS_FAILED+=1
)

REM Test 2: Get all stocks
echo Testing: Get all stocks...
curl -s "%BASE_URL%/stocks" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Get all stocks
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Get all stocks
    set /a TESTS_FAILED+=1
)

REM Test 3: Get stock details
echo Testing: Get stock details...
curl -s "%BASE_URL%/stocks/AAPL" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Get stock details
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Get stock details
    set /a TESTS_FAILED+=1
)

REM Test 4: Get top movers
echo Testing: Get top movers...
curl -s "%BASE_URL%/stocks/top/movers" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Get top movers
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Get top movers
    set /a TESTS_FAILED+=1
)

REM Test 5: Get price history
echo Testing: Get price history...
curl -s "%BASE_URL%/prices/AAPL?days=30" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Get price history
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Get price history
    set /a TESTS_FAILED+=1
)

REM Test 6: Get technical indicators
echo Testing: Get technical indicators...
curl -s "%BASE_URL%/indicators/AAPL" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Get technical indicators
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Get technical indicators
    set /a TESTS_FAILED+=1
)

REM Test 7: Scan breakouts
echo Testing: Scan breakouts...
curl -s "%BASE_URL%/indicators/scan/breakouts" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Scan breakouts
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Scan breakouts
    set /a TESTS_FAILED+=1
)

REM Test 8: Get portfolio
echo Testing: Get portfolio...
curl -s "%BASE_URL%/portfolio/user-1" >nul 2>&1
if !errorlevel! equ 0 (
    echo [PASS] Get portfolio
    set /a TESTS_PASSED+=1
) else (
    echo [FAIL] Get portfolio
    set /a TESTS_FAILED+=1
)

REM Results
echo.
echo ================================================================
echo                   Test Results Summary
echo ================================================================
echo.
echo Passed: !TESTS_PASSED!
echo Failed: !TESTS_FAILED!
echo.

if !TESTS_FAILED! equ 0 (
    echo [SUCCESS] All tests passed!
    exit /b 0
) else (
    echo [FAILURE] Some tests failed.
    exit /b 1
)

endlocal
