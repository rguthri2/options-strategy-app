# ⚠️ ALMALINUX DEPLOYMENT GUIDE

**Your VPS is running AlmaLinux!** This requires different setup than Ubuntu.

---

## 🔴 IMPORTANT - READ THIS FIRST!

AlmaLinux is RHEL-based, NOT Debian-based. 

**The Ubuntu scripts won't work!** ❌

- ❌ `vps-deploy.sh` - Won't work on AlmaLinux
- ❌ Ubuntu commands with `apt-get` - Won't work
- ❌ `postgresql` - Should be `postgresql15-server`
- ❌ `redis-server` - Should be `redis`

**Use these instead:** ✅

- ✅ `vps-deploy-almalinux.sh` - Use THIS script
- ✅ `VPS_QUICK_REFERENCE_ALMALINUX.md` - Use THIS guide
- ✅ AlmaLinux-specific commands below

---

## 🚀 QUICK START - ALMALINUX ONLY

### Already on VPS? Follow This:

```bash
# 1. SSH to VPS (you're probably already here)
ssh root@70.36.114.244

# 2. Download AlmaLinux setup script
cd /tmp
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/options-strategy-app/main/vps-deploy-almalinux.sh

# 3. Make executable
chmod +x vps-deploy-almalinux.sh

# 4. Run it (takes ~10 minutes)
bash vps-deploy-almalinux.sh
```

**Wait for completion.** You'll see:
```
✅ ALL SERVICES INSTALLED SUCCESSFULLY!
```

---

## 🔧 What Gets Installed

The AlmaLinux script installs:

```
✅ Node.js 18+
✅ PostgreSQL 15 (service: postgresql-15)
✅ Redis (service: redis)
✅ Nginx
✅ Certbot
✅ PM2
✅ Build tools (gcc, make, etc)
```

---

## 📋 After Setup Completes

### Step 1: Create Database

```bash
# Connect to PostgreSQL
sudo -u postgres /usr/pgsql-15/bin/psql

# Run these commands:
CREATE USER trading_user WITH PASSWORD 'trading_password_123';
CREATE DATABASE trading_platform OWNER trading_user;
ALTER ROLE trading_user CREATEDB;
\q
```

### Step 2: Clone Your App

```bash
mkdir -p /var/www/options-strategy-app
cd /var/www/options-strategy-app
git clone https://github.com/YOUR_USERNAME/options-strategy-app.git .
```

### Step 3: Configure & Build

```bash
cd backend
cp .env.example .env
nano .env  # Add your API keys

npm install
npm run build
npm run migrations

cd ../frontend
npm install
npm run build
```

### Step 4: Start with PM2

```bash
cd /var/www/options-strategy-app
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Step 5: Setup Nginx & SSL

```bash
# Create Nginx config
sudo tee /etc/nginx/conf.d/options-strategy.conf > /dev/null << 'EOF'
upstream backend {
    server localhost:5000;
}

upstream frontend {
    server localhost:3000;
}

server {
    server_name optionstrategy.rginvestor67.com;
    listen 80;

    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://frontend;
        proxy_set_header Host $host;
    }
}
EOF

# Test & restart
nginx -t
systemctl restart nginx

# Get SSL certificate
certbot --nginx -d optionstrategy.rginvestor67.com
```

**Done!** ✅ Your app is live at: https://optionstrategy.rginvestor67.com

---

## 🛠️ AlmaLinux Commands (Different from Ubuntu!)

### Start Services

```bash
# PostgreSQL
systemctl start postgresql-15

# Redis
systemctl start redis

# Nginx
systemctl start nginx
```

### Check Status

```bash
# PostgreSQL
systemctl status postgresql-15

# Redis
systemctl status redis

# Nginx
systemctl status nginx

# PM2
pm2 status
```

### Connect to PostgreSQL

```bash
# Regular psql command WON'T work on AlmaLinux!
psql -U trading_user ...  # ❌ Might fail

# Use full path instead
/usr/pgsql-15/bin/psql -U trading_user ...  # ✅ Works

# Or as postgres user
sudo -u postgres /usr/pgsql-15/bin/psql
```

---

## ⚠️ Common AlmaLinux Issues

### Issue 1: `apt-get: command not found`

**Problem:** Ubuntu commands on AlmaLinux  
**Solution:** Use `yum` instead of `apt`

```bash
# ❌ Don't do this
apt-get install nginx

# ✅ Do this instead
yum install nginx
```

### Issue 2: `psql: command not found`

**Problem:** PostgreSQL command not found  
**Solution:** Use full path on AlmaLinux

```bash
# ❌ Doesn't work
psql -U trading_user -d trading_platform

# ✅ Works
/usr/pgsql-15/bin/psql -U trading_user -d trading_platform

# ✅ Also works
sudo -u postgres /usr/pgsql-15/bin/psql
```

### Issue 3: Service not found errors

**Problem:** Service names different on AlmaLinux  

| Service | Ubuntu | AlmaLinux |
|---------|--------|-----------|
| PostgreSQL | `postgresql` | `postgresql-15` |
| Redis | `redis-server` | `redis` |
| Nginx | `nginx` | `nginx` |

**Solution:** Use correct names for AlmaLinux

```bash
# ❌ This won't work
systemctl start postgresql

# ✅ Use this
systemctl start postgresql-15
```

### Issue 4: SELinux blocking connections

**Problem:** SELinux might block some services  
**Solution:** Check status

```bash
# See if SELinux is enabled
getenforce

# If 'Enforcing', you may need to adjust rules
# For now, check logs:
tail -f /var/log/audit/audit.log
```

---

## 📚 Files You Need

**For AlmaLinux deployment, use these files:**

| File | Purpose | When to Use |
|------|---------|-----------|
| `vps-deploy-almalinux.sh` | Automated setup | **FIRST** - Run this on VPS |
| `VPS_QUICK_REFERENCE_ALMALINUX.md` | Commands reference | While setting up |
| `ALMALINUX_DEPLOYMENT.md` | This file | Getting started |
| `ecosystem.config.js` | PM2 config | Copy to app folder |

**Don't use these on AlmaLinux:**

| File | Why Not |
|------|---------|
| `vps-deploy.sh` | Ubuntu/Debian only |
| `VPS_QUICK_REFERENCE.md` | Ubuntu commands |
| `VPS_DEPLOYMENT.md` | Uses `apt-get` |

---

## 🔄 Step-by-Step Status Check

After running `vps-deploy-almalinux.sh`, verify everything:

```bash
# Check 1: Node.js
node --version
# Expected: v18.x or higher ✅

# Check 2: PostgreSQL
/usr/pgsql-15/bin/psql --version
# Expected: psql (PostgreSQL) 15.x ✅

# Check 3: Redis
redis-cli ping
# Expected: PONG ✅

# Check 4: Nginx
nginx -v
# Expected: nginx/1.x.x ✅

# Check 5: PM2
pm2 --version
# Expected: 5.x or higher ✅

# Check 6: Services running
systemctl is-active postgresql-15  # active
systemctl is-active redis          # active
systemctl is-active nginx          # active
```

All should show ✅ **active** or ✅ **success**

---

## 📞 Troubleshooting

### PostgreSQL won't start

```bash
# Check status
systemctl status postgresql-15

# Check logs
tail -f /var/lib/pgsql/15/data/log/postgresql.log

# Try restart
systemctl restart postgresql-15
```

### Redis won't start

```bash
# Check status
systemctl status redis

# Check logs
tail -f /var/log/redis/redis.log

# Try restart
systemctl restart redis
```

### Application won't connect to database

```bash
# Verify PostgreSQL is running
systemctl status postgresql-15

# Check if database exists
sudo -u postgres /usr/pgsql-15/bin/psql -l

# Check connection
psql -h localhost -U trading_user -d trading_platform -c "SELECT 1;"
```

### Nginx giving errors

```bash
# Test config
nginx -t

# Check logs
tail -f /var/log/nginx/error.log

# Restart
systemctl restart nginx
```

---

## ✅ AlmaLinux Deployment Summary

```
Step 1: Run vps-deploy-almalinux.sh
        ↓
Step 2: Create PostgreSQL database
        ↓
Step 3: Clone application from GitHub
        ↓
Step 4: Configure .env
        ↓
Step 5: npm install & npm run build
        ↓
Step 6: Run migrations
        ↓
Step 7: pm2 start ecosystem.config.js
        ↓
Step 8: Setup Nginx & SSL
        ↓
✅ LIVE AT: https://optionstrategy.rginvestor67.com
```

---

## 🎯 Your Next Command

**On your VPS, run:**

```bash
cd /tmp
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/options-strategy-app/main/vps-deploy-almalinux.sh
chmod +x vps-deploy-almalinux.sh
bash vps-deploy-almalinux.sh
```

**Then follow:** `VPS_QUICK_REFERENCE_ALMALINUX.md` steps 4-12

---

## 📚 Additional Reading

- [VPS_QUICK_REFERENCE_ALMALINUX.md](VPS_QUICK_REFERENCE_ALMALINUX.md) - Commands for AlmaLinux
- [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md) - Detailed info (note: Ubuntu-focused)
- [GITHUB_SETUP.md](GITHUB_SETUP.md) - How to use GitHub

---

**Ready? Let's deploy on AlmaLinux!** 🚀

Run: `bash vps-deploy-almalinux.sh` (on your VPS)

