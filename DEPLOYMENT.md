# 🚀 VPS Deployment Guide

## Quick Deploy (One-Command)

```powershell
.\deploy-to-vps.ps1
```

---

## 📋 Prerequisites

### 1. SSH Key Setup

You provided the **public key**, but we need your **private SSH key** to authenticate.

#### Option A: You have the private key file
```powershell
# Copy your private key to the .ssh folder
Copy-Item "C:\path\to\your\id_ed25519" "$env:USERPROFILE\.ssh\id_ed25519"

# Set permissions
$Acl = Get-Acl "$env:USERPROFILE\.ssh\id_ed25519"
$Acl.SetAccessRuleProtection($true, $false)
Set-Acl -Path "$env:USERPROFILE\.ssh\id_ed25519" -AclObject $Acl
```

#### Option B: Generate new SSH key pair
```powershell
# Generate new key
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519" -N ""

# Copy the public key and add it to VPS authorized_keys:
# ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEz/TVqZAmyQVZnPwh3KajW8lkgv5l5OnbTVBIe93hXT roy@compustores.com
```

---

## 🎯 Deployment Steps

### Step 1: Verify SSH Connection
```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" root@70.36.114.244 "echo 'Connected!'"
```

Should output: `Connected!`

### Step 2: Run Deployment
```powershell
cd "C:\Claude Projects\Options Strategy App"
.\deploy-to-vps.ps1
```

This will:
- ✅ Pull latest code from GitHub (https://github.com/rguthri2/options-strayegy-app)
- ✅ Install backend dependencies (`npm install --legacy-peer-deps`)
- ✅ Build backend (`npm run build`)
- ✅ Install frontend dependencies (`npm install --legacy-peer-deps`)
- ✅ Build frontend (`npm run build`)
- ✅ Restart PM2 processes

### Step 3: Verify Deployment
```powershell
# Check PM2 status
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" root@70.36.114.244 "pm2 status"

# View logs
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" root@70.36.114.244 "pm2 logs"

# Restart all (if needed)
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" root@70.36.114.244 "pm2 restart all"
```

---

## 🔧 Manual Commands (if needed)

Run these on the VPS directly:

```bash
# SSH into VPS
ssh -i "id_ed25519" root@70.36.114.244

# On VPS, run:
cd /opt/options-strategy-app
git pull origin main

# Backend
cd backend
npm install --legacy-peer-deps
npm run build

# Frontend  
cd ../frontend
npm install --legacy-peer-deps
npm run build

# Restart
pm2 restart all
```

---

## 📊 VPS Structure

```
/opt/options-strategy-app/
├── backend/
│   ├── src/
│   ├── dist/           (built files)
│   ├── node_modules/
│   └── package.json
├── frontend/
│   ├── src/
│   ├── build/          (built files)
│   ├── node_modules/
│   └── package.json
├── ecosystem.config.js (PM2 config)
└── .env               (production secrets)
```

---

## 🌐 After Deployment

Your app will be available at:
- **Frontend:** https://optionstrategy.rginvestor67.com
- **Backend API:** https://optionstrategy.rginvestor67.com/api
- **WebSocket:** wss://optionstrategy.rginvestor67.com

---

## 🐛 Troubleshooting

### SSH Connection Refused
```powershell
# Check if key is readable
Test-Path "$env:USERPROFILE\.ssh\id_ed25519"

# Try with explicit key path
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" -v root@70.36.114.244
```

### npm install still failing
```bash
# On VPS, use force
npm install --legacy-peer-deps --force

# Or clean install
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

### PM2 processes not starting
```bash
# Check status
pm2 status

# View logs
pm2 logs

# Restart manually
pm2 start ecosystem.config.js
```

### Port already in use
```bash
# Find what's using port 5000/3000
lsof -i :5000
lsof -i :3000

# Kill process
kill -9 <PID>
```

---

## 📝 Notes

- **Deployment time:** ~2-3 minutes
- **No downtime:** PM2 handles graceful restarts
- **Automatic:** Script handles all steps
- **Logs:** Available via `pm2 logs`
- **Environment:** Production secrets in `/opt/options-strategy-app/.env`

---

## ✅ Success Checklist

- [ ] SSH key is in `~/.ssh/id_ed25519`
- [ ] SSH connection works
- [ ] `.\deploy-to-vps.ps1` completes without errors
- [ ] `pm2 status` shows "online" processes
- [ ] Frontend loads at https://optionstrategy.rginvestor67.com
- [ ] Backend API responds at https://optionstrategy.rginvestor67.com/api

---

**Happy deploying! 🚀**
