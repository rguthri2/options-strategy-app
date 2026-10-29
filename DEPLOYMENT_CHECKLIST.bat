@echo off
REM VPS Deployment Checklist - Windows Version
REM Print this and check off items as you complete them

setlocal

echo.
echo ================================================================
echo    VPS Deployment Checklist - Options Strategy App
echo    Domain: optionstrategy.rginvestor67.com
echo    VPS IP: 70.36.114.244
echo ================================================================
echo.

:menu
echo.
echo Select a deployment phase:
echo.
echo   1. GitHub Setup (Push code to GitHub)
echo   2. VPS Prerequisites (Install Node, PostgreSQL, etc)
echo   3. Application Setup (Clone and configure app)
echo   4. Database Setup (Create tables and data)
echo   5. SSL Certificate (Setup HTTPS)
echo   6. Verification (Test everything)
echo   7. View Full Checklist
echo   8. Exit
echo.

set /p choice="Enter your choice (1-8): "

if "!choice!"=="1" goto github
if "!choice!"=="2" goto vps_prereq
if "!choice!"=="3" goto app_setup
if "!choice!"=="4" goto database
if "!choice!"=="5" goto ssl
if "!choice!"=="6" goto verify
if "!choice!"=="7" goto checklist
if "!choice!"=="8" exit /b 0

echo Invalid choice. Please try again.
goto menu

:github
echo.
echo ========== PHASE 1: GitHub Setup ==========
echo.
echo TODO ITEMS:
echo [ ] Create GitHub account at https://github.com
echo [ ] Create new repository: options-strategy-app
echo [ ] Set to PRIVATE (recommended)
echo [ ] Run push-to-github.bat
echo [ ] Verify code appears on GitHub
echo.
pause
goto menu

:vps_prereq
echo.
echo ========== PHASE 2: VPS Prerequisites ==========
echo.
echo SSH into VPS and run:
echo   ssh root@70.36.114.244
echo.
echo Then run automated setup:
echo   bash vps-deploy.sh
echo.
echo This will install:
echo   - Node.js 18+
echo   - PostgreSQL
echo   - Redis
echo   - Nginx
echo   - PM2
echo   - Certbot
echo.
echo Estimated time: 5-10 minutes
echo.
pause
goto menu

:app_setup
echo.
echo ========== PHASE 3: Application Setup ==========
echo.
echo SSH into VPS:
echo   ssh root@70.36.114.244
echo.
echo Run these commands:
echo   cd /var/www/options-strategy-app
echo   git clone https://github.com/YOUR_USERNAME/options-strategy-app.git .
echo.
echo   cd backend
echo   cp .env.example .env
echo   nano .env
echo.
echo Then edit .env with:
echo   - DB_PASSWORD
echo   - FINNHUB_API_KEY
echo   - JWT_SECRET
echo.
echo Then run:
echo   npm install
echo   npm run build
echo.
echo   cd ../frontend
echo   npm install
echo   npm run build
echo.
echo Estimated time: 10-15 minutes
echo.
pause
goto menu

:database
echo.
echo ========== PHASE 4: Database Setup ==========
echo.
echo SSH into VPS and run:
echo   ssh root@70.36.114.244
echo.
echo   cd /var/www/options-strategy-app/backend
echo   npm run migrations
echo.
echo Then verify:
echo   psql -h localhost -U trading_user -d trading_platform -c "\dt"
echo.
echo You should see 5 tables:
echo   - stocks
echo   - stock_prices
echo   - technical_indicators
echo   - portfolios
echo   - user_alerts
echo.
echo Estimated time: 2-5 minutes
echo.
pause
goto menu

:ssl
echo.
echo ========== PHASE 5: SSL Certificate ==========
echo.
echo SSH into VPS and run:
echo   ssh root@70.36.114.244
echo.
echo   pm2 start ecosystem.config.js
echo   pm2 save
echo   pm2 startup
echo.
echo Then setup SSL:
echo   certbot --nginx -d optionstrategy.rginvestor67.com
echo.
echo Follow prompts to create certificate
echo.
echo Estimated time: 3-5 minutes
echo.
pause
goto menu

:verify
echo.
echo ========== PHASE 6: Verification ==========
echo.
echo Run these tests:
echo.
echo 1. Test API health:
echo    curl https://optionstrategy.rginvestor67.com/api/health
echo.
echo 2. Check application status:
echo    pm2 status
echo    pm2 logs
echo.
echo 3. View database:
echo    psql -U trading_user -d trading_platform
echo    SELECT COUNT(*) FROM stocks;
echo.
echo 4. Open in browser:
echo    https://optionstrategy.rginvestor67.com
echo.
echo Expected results:
echo    [OK] Health endpoint returns {"status":"ok",...}
echo    [OK] Frontend loads
echo    [OK] No errors in logs
echo.
pause
goto menu

:checklist
echo.
echo ================================================================
echo               COMPLETE DEPLOYMENT CHECKLIST
echo ================================================================
echo.
echo PRE-DEPLOYMENT:
echo   [ ] GitHub account created
echo   [ ] GitHub repository created (private)
echo   [ ] Local code pushed to GitHub
echo   [ ] SSH key added to VPS (optional but recommended)
echo   [ ] Finnhub API key obtained
echo   [ ] Domain DNS configured
echo.
echo PHASE 1 - VPS SETUP:
echo   [ ] Connected to VPS via SSH
echo   [ ] System updated (apt-get update/upgrade)
echo   [ ] Node.js 18+ installed
echo   [ ] PostgreSQL installed and running
echo   [ ] Redis installed and running
echo   [ ] Nginx installed
echo   [ ] Certbot installed
echo   [ ] PM2 installed globally
echo.
echo PHASE 2 - DATABASE:
echo   [ ] PostgreSQL service running
echo   [ ] trading_user created
echo   [ ] trading_platform database created
echo   [ ] Verified database connection
echo.
echo PHASE 3 - APPLICATION:
echo   [ ] Application directory created (/var/www/options-strategy-app)
echo   [ ] Repository cloned from GitHub
echo   [ ] Backend dependencies installed
echo   [ ] Frontend dependencies installed
echo   [ ] .env file created with production values
echo.
echo PHASE 4 - BUILD:
echo   [ ] Backend built successfully (npm run build)
echo   [ ] Frontend built successfully (npm run build)
echo   [ ] No build errors
echo.
echo PHASE 5 - DATABASE MIGRATIONS:
echo   [ ] Database migrations ran successfully
echo   [ ] All 5 tables created
echo   [ ] Database populated with schema
echo.
echo PHASE 6 - PM2 SETUP:
echo   [ ] PM2 ecosystem.config.js copied to app directory
echo   [ ] Applications started with PM2
echo   [ ] PM2 saved (pm2 save)
echo   [ ] PM2 startup configured
echo.
echo PHASE 7 - SSL/HTTPS:
echo   [ ] Nginx configured with reverse proxy
echo   [ ] SSL certificate obtained (Certbot)
echo   [ ] Certificate auto-renewal configured
echo   [ ] HTTP redirects to HTTPS
echo.
echo PHASE 8 - VERIFICATION:
echo   [ ] Domain resolves to VPS IP
echo   [ ] API health endpoint responds
echo   [ ] Frontend dashboard loads
echo   [ ] No errors in PM2 logs
echo   [ ] Database queries work
echo.
echo POST-DEPLOYMENT:
echo   [ ] Database backups scheduled
echo   [ ] Log rotation configured
echo   [ ] Monitoring setup (optional)
echo   [ ] Domain email configured (optional)
echo   [ ] SSH hardened (optional but recommended)
echo.
echo ================================================================
echo.
pause
goto menu
