#!/usr/bin/env pwsh

$VPS_IP = "70.36.114.244"
$VPS_USER = "root"
$SSHKey = "$env:USERPROFILE\.ssh\id_ed25519"

Write-Host "================================================" -ForegroundColor Yellow
Write-Host "🚀 Options Strategy App - VPS Deployment" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path $SSHKey)) {
    Write-Host "SSH key not found: $SSHKey" -ForegroundColor Red
    exit 1
}

Write-Host "Testing SSH connection..." -ForegroundColor Yellow
ssh -i $SSHKey -o ConnectTimeout=5 "${VPS_USER}@${VPS_IP}" "echo 'Connected'" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "SSH connection failed" -ForegroundColor Red
    exit 1
}
Write-Host "SSH connection successful" -ForegroundColor Green
Write-Host ""

Write-Host "Starting deployment..." -ForegroundColor Yellow
Write-Host ""

$BashScript = @'
#!/bin/bash
set -e

APP_DIR="/opt/options-strategy-app"
GITHUB_REPO="https://github.com/rguthri2/options-strategy-app.git"

echo ""
echo "Step 1: Navigating to app directory..."
mkdir -p $APP_DIR
cd $APP_DIR

echo "Step 2: Pulling latest code from GitHub..."

# Check if we have a valid existing repo
if [ -d ".git" ] && git rev-parse HEAD >/dev/null 2>&1; then
    # We have a valid repo, try to update it
    git fetch origin 2>/dev/null
    
    # Detect default branch from remote
    DEFAULT_BRANCH=$(git ls-remote --symref origin HEAD 2>/dev/null | head -1 | sed 's/ref: refs\/heads\///' | sed 's/\tHEAD//')
    
    # If detection failed, try common branches
    if [ -z "$DEFAULT_BRANCH" ]; then
        DEFAULT_BRANCH=$(git branch -r 2>/dev/null | grep -E 'origin/(main|master)$' | head -1 | sed 's/.*origin\///')
    fi
    
    # If we have a valid branch, reset to it
    if [ -n "$DEFAULT_BRANCH" ] && git rev-parse origin/$DEFAULT_BRANCH >/dev/null 2>&1; then
        git reset --hard origin/$DEFAULT_BRANCH
    else
        # Failed to find branch, do a fresh clone
        cd ..
        rm -rf options-strategy-app
        git clone $GITHUB_REPO options-strategy-app
        cd options-strategy-app
    fi
else
    # No valid repo, clean up and clone fresh
    cd ..
    if [ -d "options-strategy-app" ]; then
        rm -rf options-strategy-app
    fi
    git clone $GITHUB_REPO options-strategy-app
    cd options-strategy-app
fi

echo ""
echo "Step 2b: Cleaning up package.json (removing broken packages)..."
# Remove ta-lib packages that don't exist in npm registry
sed -i '/\"ta-lib\"/d' backend/package.json
sed -i '/\"ta-lib-typescript\"/d' backend/package.json
echo "Cleanup complete"

echo ""
echo "Step 3: Installing backend dependencies..."
cd backend
npm install --legacy-peer-deps
echo "Backend dependencies installed"

echo ""
echo "Step 4: Backend ready (using ts-node runtime)..."
echo "Backend will run with ts-node - no build step needed"

echo ""
echo "Step 5: Installing frontend dependencies..."
cd ../frontend
npm install --legacy-peer-deps
echo "Frontend dependencies installed"

echo ""
echo "Step 6: Building frontend..."
npm run build
echo "Frontend built successfully"

echo ""
echo "Step 7: Restarting PM2 processes..."
cd ..
pm2 restart all
echo "PM2 processes restarted"

echo ""
echo "DEPLOYMENT SUCCESSFUL!"
echo ""
echo "Status:"
pm2 status
'@

$BashScript -replace "`r`n", "`n" | ssh -i $SSHKey "${VPS_USER}@${VPS_IP}" "bash -s"

Write-Host ""
Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host ""
