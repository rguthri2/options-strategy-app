# 🚀 VPS Deployment Guide - Options Strategy App

**VPS Details:**
- Host: CyberPanel VPS
- IP: 70.36.114.244
- Domain: optionstrategy.rginvestor67.com
- User: root

---

## Phase 1️⃣: Pre-Deployment Checklist

- [ ] GitHub repository created and code pushed
- [ ] SSH key added to VPS (or use password)
- [ ] Domain DNS configured to point to VPS IP
- [ ] Finnhub API key ready
- [ ] Database backup plan created
- [ ] SSL certificate strategy decided (Let's Encrypt or CyberPanel managed)

---

## Phase 2️⃣: Initial VPS Setup

### Step 1: Connect to VPS

```bash
ssh root@70.36.114.244
```

### Step 2: Update System

```bash
apt-get update
apt-get upgrade -y
```

### Step 3: Install Prerequisites

```bash
# Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# PostgreSQL
apt-get install -y postgresql postgresql-contrib

# Redis
apt-get install -y redis-server

# Git
apt-get install -y git

# Nginx (for reverse proxy)
apt-get install -y nginx

# Certbot for SSL
apt-get install -y certbot python3-certbot-nginx

# Build tools
apt-get install -y build-essential python3-dev

# Verify installations
node --version
npm --version
psql --version
redis-cli --version
```

✅ All prerequisites installed!

---

## Phase 3️⃣: Database Setup

### Step 1: Start PostgreSQL

```bash
systemctl start postgresql
systemctl enable postgresql
```

### Step 2: Create Database & User

```bash
# Connect to PostgreSQL as root
sudo -u postgres psql

# In the PostgreSQL shell:
CREATE USER trading_user WITH PASSWORD 'secure_password_here';
CREATE DATABASE trading_platform OWNER trading_user;
ALTER ROLE trading_user CREATEDB;
\q
```

### Step 3: Verify Connection

```bash
psql -h localhost -U trading_user -d trading_platform -c "SELECT 1;"
```

✅ Database ready!

---

## Phase 4️⃣: Clone & Setup Application

### Step 1: Create App Directory

```bash
mkdir -p /var/www/options-strategy-app
cd /var/www/options-strategy-app
```

### Step 2: Clone from GitHub

```bash
# HTTPS (if no SSH key)
git clone https://github.com/YOUR_USERNAME/options-strategy-app.git .

# OR SSH (if SSH key configured)
git clone git@github.com:YOUR_USERNAME/options-strategy-app.git .
```

### Step 3: Install Dependencies

```bash
cd backend
npm install

cd ../frontend
npm install

cd ..
```

### Step 4: Configure Backend Environment

```bash
cd backend
cp .env.example .env
nano .env
```

**Update these values:**
```
PORT=5000
NODE_ENV=production
DB_HOST=localhost
DB_PORT=5432
DB_USER=trading_user
DB_PASSWORD=secure_password_here
DB_NAME=trading_platform
FINNHUB_API_KEY=your_api_key_here
JWT_SECRET=generate_secure_random_string_here
REDIS_URL=redis://localhost:6379
FRONTEND_URL=https://optionstrategy.rginvestor67.com
```

### Step 5: Run Database Migrations

```bash
npm run migrations
```

✅ Database initialized!

---

## Phase 5️⃣: Setup Services with PM2

### Step 1: Install PM2 Globally

```bash
npm install -g pm2
```

### Step 2: Create PM2 Ecosystem Config

```bash
cd /var/www/options-strategy-app
nano ecosystem.config.js
```

**Paste this:**
```javascript
module.exports = {
  apps: [
    {
      name: 'options-trading-backend',
      script: './backend/dist/index.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'options-trading-frontend',
      script: './frontend/node_modules/.bin/serve',
      args: '-s frontend/build -l 3000',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
```

### Step 3: Build Applications

```bash
# Backend
cd backend
npm run build
cd ..

# Frontend
cd frontend
npm run build
cd ..
```

### Step 4: Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

✅ Apps running!

---

## Phase 6️⃣: Configure Nginx Reverse Proxy

### Step 1: Create Nginx Config

```bash
nano /etc/nginx/sites-available/options-strategy
```

**Paste this:**
```nginx
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

    # Backend API
    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket
    location /socket.io {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Frontend
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Step 2: Enable Config

```bash
ln -s /etc/nginx/sites-available/options-strategy /etc/nginx/sites-enabled/

# Test config
nginx -t

# Restart Nginx
systemctl restart nginx
```

---

## Phase 7️⃣: SSL Certificate (Let's Encrypt)

### Step 1: Get SSL Certificate

```bash
certbot --nginx -d optionstrategy.rginvestor67.com
```

Follow prompts to create certificate.

### Step 2: Verify Auto-Renewal

```bash
certbot renew --dry-run
```

---

## Phase 8️⃣: Verify Deployment

### Step 1: Check Application Status

```bash
pm2 status
pm2 logs options-trading-backend
pm2 logs options-trading-frontend
```

### Step 2: Test API

```bash
curl https://optionstrategy.rginvestor67.com/api/health
```

✅ Should return: `{"status":"ok",...}`

### Step 3: Test Frontend

Visit in browser: https://optionstrategy.rginvestor67.com

✅ Should load dashboard!

---

## Phase 9️⃣: Monitoring & Maintenance

### Setup Log Rotation

```bash
nano /etc/logrotate.d/options-strategy
```

**Paste:**
```
/var/www/options-strategy-app/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 root root
}
```

### Restart Application

```bash
pm2 restart all
```

### View Real-time Logs

```bash
pm2 monit
```

### Backup Database

```bash
# Create backup directory
mkdir -p /var/backups/trading-db

# Backup database
pg_dump -U trading_user -d trading_platform > /var/backups/trading-db/backup_$(date +%Y%m%d_%H%M%S).sql
```

---

## 📊 Post-Deployment Checklist

- [ ] Application accessible at https://optionstrategy.rginvestor67.com
- [ ] API responding to requests
- [ ] Database migrations complete
- [ ] SSL certificate installed
- [ ] PM2 auto-restart configured
- [ ] Logs being generated correctly
- [ ] Database backups scheduled
- [ ] Monitoring tools setup (optional)

---

## 🚨 Troubleshooting

### Application won't start
```bash
pm2 logs
# Check error messages
```

### Port conflicts
```bash
lsof -i :5000
lsof -i :3000
# Kill conflicting processes if needed
```

### Database connection failed
```bash
psql -h localhost -U trading_user -d trading_platform -c "SELECT 1;"
```

### Nginx not routing traffic
```bash
nginx -t
systemctl restart nginx
```

### SSL certificate issues
```bash
certbot certificates
certbot renew --force-renewal
```

---

## 📞 Support URLs

- App: https://optionstrategy.rginvestor67.com
- API: https://optionstrategy.rginvestor67.com/api/health
- CyberPanel: Use your panel's IP/domain for server management

---

**Deployment Status: Ready to Execute!** 🚀

Next: Run the VPS setup script to automate installation.
