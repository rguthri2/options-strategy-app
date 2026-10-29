# 🚀 VPS Deployment Quick Reference

**Project:** Options Strategy App  
**Domain:** optionstrategy.rginvestor67.com  
**VPS IP:** 70.36.114.244  
**VPS Type:** CyberPanel  
**SSH:** `ssh root@70.36.114.244`  

---

## ⚡ 30-Second Overview

```
1. Push to GitHub (local computer)
2. SSH into VPS
3. Run automated setup script
4. Configure application
5. Start services
6. Setup SSL
7. Done!
```

---

## 📋 Step-by-Step Commands

### STEP 1: Push Code to GitHub (Local Computer - Windows)

```bash
cd "C:\Claude Projects\Options Strategy App"

# Run the batch script
./push-to-github.bat

# Or manual commands:
git init
git add .
git commit -m "Initial commit - Options Strategy App"
git remote add origin https://github.com/YOUR_USERNAME/options-strategy-app.git
git branch -M main
git push -u origin main
```

**Files created:**
- ✅ `push-to-github.bat` - Windows script
- ✅ `push-to-github.sh` - Linux/Mac script
- ✅ `GITHUB_SETUP.md` - Detailed guide

---

### STEP 2: Connect to VPS

```bash
ssh root@70.36.114.244
```

**Password:** Your VPS password  
**Alternative:** If SSH key configured, it will authenticate automatically

---

### STEP 3: Run Automated Setup (5 minutes)

```bash
cd /tmp

# Download setup script
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/options-strategy-app/main/vps-deploy.sh

# Make executable
chmod +x vps-deploy.sh

# Run (takes ~5-10 minutes)
bash vps-deploy.sh
```

**Or manually:**

```bash
# System update
apt-get update
apt-get upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PostgreSQL, Redis, Nginx, etc
apt-get install -y postgresql postgresql-contrib redis-server nginx certbot python3-certbot-nginx git build-essential

# Start services
systemctl start postgresql
systemctl start redis-server
systemctl start nginx
systemctl enable postgresql
systemctl enable redis-server
systemctl enable nginx

# Install PM2
npm install -g pm2
```

**Status after Step 3:**
- ✅ Node.js 18+ installed
- ✅ PostgreSQL running
- ✅ Redis running
- ✅ Nginx ready
- ✅ PM2 ready

---

### STEP 4: Create Database

```bash
# Connect to PostgreSQL
sudo -u postgres psql

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

# Clone repository
git clone https://github.com/YOUR_USERNAME/options-strategy-app.git .

# Or using SSH (if key configured)
git clone git@github.com:YOUR_USERNAME/options-strategy-app.git .
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

**Expected:** No errors ✅

---

### STEP 8: Run Database Migrations

```bash
cd /var/www/options-strategy-app/backend
npm run migrations
```

**Expected output:**
```
query: CREATE TABLE "stocks"...
query: CREATE TABLE "stock_prices"...
query: CREATE TABLE "technical_indicators"...
query: CREATE TABLE "portfolios"...
query: CREATE TABLE "user_alerts"...
✅ Migrations complete
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

**Expected output:**
```
┌─────────────────────────────┬─────┬─────────┬────────┐
│ Name                        │ id  │ mode    │ status │
├─────────────────────────────┼─────┼─────────┼────────┤
│ options-trading-backend     │ 0   │ cluster │ online │
│ options-trading-frontend    │ 1   │ cluster │ online │
└─────────────────────────────┴─────┴─────────┴────────┘
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
sudo tee /etc/nginx/sites-available/options-strategy > /dev/null << 'EOF'
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

# Enable configuration
ln -s /etc/nginx/sites-available/options-strategy /etc/nginx/sites-enabled/

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

**Result:** HTTPS certificate installed ✅

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

**Expected results:**
- ✅ API returns `{"status":"ok",...}`
- ✅ Both PM2 apps show "online"
- ✅ No errors in logs
- ✅ Database query works
- ✅ Nginx is active

---

## 🔧 Common Commands

### Check Application Status
```bash
pm2 status
pm2 monit
pm2 logs options-trading-backend
pm2 logs options-trading-frontend
```

### Restart Application
```bash
pm2 restart all
```

### Stop Application
```bash
pm2 stop all
```

### View Database
```bash
psql -U trading_user -d trading_platform
\dt              # List tables
SELECT * FROM stocks;  # View stocks
\q              # Exit
```

### Check Nginx Status
```bash
nginx -t
systemctl status nginx
systemctl restart nginx
```

### View SSL Certificate
```bash
certbot certificates
```

### Backup Database
```bash
mkdir -p /var/backups/trading-db
pg_dump -U trading_user -d trading_platform > /var/backups/trading-db/backup_$(date +%Y%m%d_%H%M%S).sql
```

### Update Application from GitHub
```bash
cd /var/www/options-strategy-app
git pull origin main
npm install  # If needed
npm run build
pm2 restart all
```

---

## 📞 Troubleshooting

| Problem | Solution |
|---------|----------|
| `Connection refused` | Check if services running: `pm2 status`, `systemctl status postgresql` |
| `Database does not exist` | Run migrations: `cd backend && npm run migrations` |
| `Port already in use` | Check: `lsof -i :5000` or `lsof -i :3000` |
| `SSL certificate failed` | Check: `certbot certificates`, `certbot renew` |
| `Nginx 502 Bad Gateway` | Check backend running: `pm2 logs`, `curl localhost:5000/api/health` |
| `Git authentication failed` | Use HTTPS or setup SSH key |

---

## 📊 Post-Deployment

### Monitor Application
```bash
pm2 monit          # Real-time monitoring
pm2 logs -n 100    # Last 100 log lines
```

### Setup Auto-Backups (Optional)
```bash
# Create cron job
crontab -e

# Add this line (daily backup at 2 AM):
0 2 * * * pg_dump -U trading_user -d trading_platform > /var/backups/trading-db/backup_$(date +\%Y\%m\%d).sql
```

### Setup Firewall (Optional)
```bash
ufw allow 22      # SSH
ufw allow 80      # HTTP
ufw allow 443     # HTTPS
ufw enable
```

---

## ✅ Final Checklist

- [ ] GitHub repository has all code
- [ ] VPS SSH access working
- [ ] All prerequisites installed
- [ ] PostgreSQL database created with data
- [ ] Application cloned and configured
- [ ] Backend built and running
- [ ] Frontend built and running
- [ ] API responding at /api/health
- [ ] Domain DNS pointing to VPS
- [ ] SSL certificate installed
- [ ] Nginx reverse proxy working
- [ ] PM2 auto-restart configured
- [ ] Application accessible at domain

---

## 🎉 Deployment Complete!

**Application URL:** https://optionstrategy.rginvestor67.com  
**API Base:** https://optionstrategy.rginvestor67.com/api  
**Dashboard:** https://optionstrategy.rginvestor67.com

**Now:**
1. Test the application
2. Add stocks to database
3. Create user accounts
4. Monitor performance
5. Setup backups

**Happy trading! 📈**

---

## 📚 Additional Resources

- [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md) - Detailed guide
- [GITHUB_SETUP.md](GITHUB_SETUP.md) - GitHub integration
- [QUICK_START.md](QUICK_START.md) - Local development
- [GETTING_STARTED.md](GETTING_STARTED.md) - Complete setup

