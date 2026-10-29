# 🚀 VPS Deployment Quick Reference - ALMALINUX

**Project:** Options Strategy App  
**Domain:** optionstrategy.rginvestor67.com  
**VPS IP:** 70.36.114.244  
**VPS Type:** CyberPanel (AlmaLinux/RHEL)  
**SSH:** `ssh root@70.36.114.244`  

---

## ⚡ AlmaLinux Overview

AlmaLinux is RHEL-compatible. Key differences from Ubuntu:

| Task | Ubuntu | AlmaLinux |
|------|--------|-----------|
| Package Manager | `apt` | `yum` / `dnf` |
| Install packages | `apt install pkg` | `yum install pkg` |
| Update system | `apt update && apt upgrade` | `yum update` |
| PostgreSQL | `postgresql` | `postgresql15-server` |
| Redis | `redis-server` | `redis` |
| Python cert | `python3-certbot-nginx` | `python3-certbot-nginx` |

---

## 📋 Step-by-Step Commands

### STEP 1: Push Code to GitHub (Local Computer - Windows)

```bash
cd "C:\Claude Projects\Options Strategy App"
./push-to-github.bat
```

---

### STEP 2: Connect to VPS

```bash
ssh root@70.36.114.244
```

---

### STEP 3: Run AlmaLinux Setup Script ⭐ IMPORTANT

**You MUST use the AlmaLinux-specific script on AlmaLinux!**

```bash
cd /tmp

# Download AlmaLinux setup script
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/options-strategy-app/main/vps-deploy-almalinux.sh

# Make executable
chmod +x vps-deploy-almalinux.sh

# Run (takes ~10 minutes)
bash vps-deploy-almalinux.sh
```

**What it installs:**
- ✅ Node.js 18+
- ✅ PostgreSQL 15
- ✅ Redis
- ✅ Nginx
- ✅ Certbot
- ✅ PM2
- ✅ Build tools

**Expected output:**
```
✅ Node.js installed
✅ PostgreSQL installed
✅ Redis installed
✅ Nginx installed
✅ Certbot installed
✅ PM2 installed
════════════════════════════════════
✅ ALL SERVICES INSTALLED SUCCESSFULLY!
```

---

### STEP 4: Create Database

```bash
# Connect to PostgreSQL (AlmaLinux version)
sudo -u postgres /usr/pgsql-15/bin/psql

# Copy & paste these commands:
CREATE USER trading_user WITH PASSWORD 'trading_password_123';
CREATE DATABASE trading_platform OWNER trading_user;
ALTER ROLE trading_user CREATEDB;
\q

# Verify
psql -h localhost -U trading_user -d trading_platform -c "SELECT 1;"
```

**Expected output:** `1` ✅

---

### STEP 5: Clone Application from GitHub

```bash
mkdir -p /var/www/options-strategy-app
cd /var/www/options-strategy-app

# Clone repository (replace YOUR_USERNAME)
git clone https://github.com/YOUR_USERNAME/options-strategy-app.git .
```

---

### STEP 6: Configure Application

```bash
cd /var/www/options-strategy-app/backend

# Copy environment template
cp .env.example .env

# Edit with your settings
nano .env
```

**Update these values in .env:**

```
PORT=5000
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_USER=trading_user
DB_PASSWORD=trading_password_123
DB_NAME=trading_platform
FINNHUB_API_KEY=pk_YOUR_KEY_HERE
JWT_SECRET=generate_random_string_here_min_32_chars
REDIS_URL=redis://localhost:6379
FRONTEND_URL=https://optionstrategy.rginvestor67.com
```

**Save:** `Ctrl+X` → `Y` → `Enter`

---

### STEP 7: Install Dependencies & Build

```bash
# Backend
cd /var/www/options-strategy-app/backend
npm install
npm run build

# Frontend
cd ../frontend
npm install
npm run build

# Check builds
ls -la ../backend/dist
ls -la ./build
```

---

### STEP 8: Run Database Migrations

```bash
cd /var/www/options-strategy-app/backend
npm run migrations
```

---

### STEP 9: Start Application with PM2

```bash
cd /var/www/options-strategy-app

# Create logs directory
mkdir -p logs

# Start applications
pm2 start ecosystem.config.js

# Verify running
pm2 status

# View logs
pm2 logs
```

### Save PM2 Configuration

```bash
pm2 save
pm2 startup
```

---

### STEP 10: Configure Nginx Reverse Proxy

```bash
# Create Nginx configuration
sudo tee /etc/nginx/conf.d/options-strategy.conf > /dev/null << 'EOF'
upstream backend {
    server localhost:5000;
    keepalive 64;
}

upstream frontend {
    server localhost:3000;
    keepalive 64;
}

server {
    server_name optionstrategy.rginvestor67.com;
    listen 80;

    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

# Test Nginx
nginx -t

# Restart Nginx
systemctl restart nginx
```

---

### STEP 11: Setup SSL Certificate

```bash
# Install SSL certificate (Let's Encrypt)
certbot --nginx -d optionstrategy.rginvestor67.com

# Follow interactive prompts:
# - Enter email
# - Agree to terms (Y)
# - Allow sharing email (N or Y)
# - Redirect HTTP to HTTPS (2 - Redirect)

# Verify auto-renewal
certbot renew --dry-run
```

---

### STEP 12: Test Everything

```bash
# Test API
curl https://optionstrategy.rginvestor67.com/api/health

# Check PM2 status
pm2 status
pm2 logs

# Check database
psql -U trading_user -d trading_platform -c "SELECT COUNT(*) FROM stocks;"

# View Nginx status
systemctl status nginx
```

---

## 🔧 Common AlmaLinux Commands

### Service Management
```bash
# Start PostgreSQL (AlmaLinux)
systemctl start postgresql-15
systemctl status postgresql-15

# Start Redis
systemctl start redis
systemctl status redis

# Start Nginx
systemctl start nginx
systemctl status nginx

# View all services
systemctl list-units --type=service
```

### PostgreSQL Commands (AlmaLinux)
```bash
# Connect to PostgreSQL
sudo -u postgres /usr/pgsql-15/bin/psql

# Quick query
psql -U trading_user -d trading_platform -c "SELECT * FROM stocks LIMIT 5;"

# Backup database
pg_dump -U trading_user -d trading_platform > backup.sql
```

### PM2 Commands
```bash
pm2 status
pm2 monit
pm2 logs
pm2 restart all
pm2 stop all
pm2 start all
```

### Nginx Commands
```bash
nginx -t              # Test config
systemctl restart nginx
systemctl reload nginx
```

### Check Service Status
```bash
# Is PostgreSQL running?
systemctl is-active postgresql-15

# Is Redis running?
systemctl is-active redis

# Is Nginx running?
systemctl is-active nginx

# All running services
systemctl list-units --type=service --state=running
```

---

## 🚨 AlmaLinux-Specific Troubleshooting

| Problem | AlmaLinux Solution |
|---------|-------------------|
| `apt-get: command not found` | Use `yum` instead: `yum install pkg` |
| `PostgreSQL service not found` | Use `postgresql-15`: `systemctl start postgresql-15` |
| `psql: command not found` | Full path: `/usr/pgsql-15/bin/psql` |
| `Can't connect to PostgreSQL` | Check `/var/lib/pgsql/15/data/` exists |
| `Redis won't start` | Check `/var/log/redis/redis.log` for errors |
| `Port 5000 in use` | `lsof -i :5000` or `netstat -tlnp \| grep 5000` |
| `Nginx config error` | Run `nginx -t` to test configuration |
| `SELinux blocking` | Check: `getenforce` (if enforcing, may need rules) |

---

## 📊 Service Paths on AlmaLinux

```
PostgreSQL 15:
  Binary: /usr/pgsql-15/bin/psql
  Data: /var/lib/pgsql/15/data/
  Config: /var/lib/pgsql/15/data/postgresql.conf
  Logs: /var/lib/pgsql/15/data/log/

Redis:
  Binary: /usr/bin/redis-cli
  Config: /etc/redis.conf
  Logs: /var/log/redis/redis.log

Nginx:
  Config: /etc/nginx/conf.d/
  Default: /etc/nginx/conf.d/default.conf
  Logs: /var/log/nginx/

Certbot:
  Certs: /etc/letsencrypt/live/
  Renewal: /etc/letsencrypt/renewal/
```

---

## ✅ AlmaLinux Deployment Checklist

- [ ] GitHub repository has all code
- [ ] VPS SSH access working
- [ ] Run `vps-deploy-almalinux.sh` ⭐ (NOT Ubuntu version!)
- [ ] All services starting: `systemctl status postgresql-15 redis nginx`
- [ ] Database created
- [ ] Application cloned from GitHub
- [ ] .env configured with API keys
- [ ] Backend built: `ls backend/dist/index.js`
- [ ] Frontend built: `ls frontend/build/index.html`
- [ ] PM2 running: `pm2 status`
- [ ] Nginx configured at `/etc/nginx/conf.d/`
- [ ] Domain DNS pointing to VPS
- [ ] SSL certificate installed
- [ ] API responding: `curl https://optionstrategy.rginvestor67.com/api/health`

---

## 🎉 Deployment Complete!

**Application URL:** https://optionstrategy.rginvestor67.com  
**API Base:** https://optionstrategy.rginvestor67.com/api  

---

## 📞 Help

- **Need Ubuntu version?** Use `vps-deploy.sh` (Ubuntu only)
- **AlmaLinux issues?** See troubleshooting table above
- **PostgreSQL help?** `/usr/pgsql-15/bin/psql` for AlmaLinux
- **Check logs:** `pm2 logs`, `/var/log/nginx/error.log`, `/var/lib/pgsql/15/data/log/`

