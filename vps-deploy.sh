#!/bin/bash

# 🚀 Automated VPS Deployment Script
# Options Strategy App - Complete Setup
# Run as: bash vps-deploy.sh

set -e

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Options Trading Platform - VPS Deployment              ║${NC}"
echo -e "${BLUE}║     IP: 70.36.114.244                                       ║${NC}"
echo -e "${BLUE}║     Domain: optionstrategy.rginvestor67.com                ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ This script must be run as root!${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Phase 1: System Update${NC}"
apt-get update
apt-get upgrade -y
echo -e "${GREEN}✅ System updated${NC}\n"

echo -e "${YELLOW}📋 Phase 2: Installing Prerequisites${NC}"

# Node.js
echo "Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
echo -e "${GREEN}✅ Node.js $(node --version)${NC}"

# PostgreSQL
echo "Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql
echo -e "${GREEN}✅ PostgreSQL installed${NC}"

# Redis
echo "Installing Redis..."
apt-get install -y redis-server
systemctl start redis-server
systemctl enable redis-server
echo -e "${GREEN}✅ Redis installed${NC}"

# Git
echo "Installing Git..."
apt-get install -y git
echo -e "${GREEN}✅ Git installed${NC}"

# Nginx
echo "Installing Nginx..."
apt-get install -y nginx
systemctl start nginx
systemctl enable nginx
echo -e "${GREEN}✅ Nginx installed${NC}"

# Certbot
echo "Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx
echo -e "${GREEN}✅ Certbot installed${NC}"

# Build tools
echo "Installing build tools..."
apt-get install -y build-essential python3-dev
echo -e "${GREEN}✅ Build tools installed${NC}\n"

echo -e "${YELLOW}📋 Phase 3: Setting Up PostgreSQL${NC}"

# Create database and user
sudo -u postgres psql << EOF
CREATE USER trading_user WITH PASSWORD 'trading_password_123';
CREATE DATABASE trading_platform OWNER trading_user;
ALTER ROLE trading_user CREATEDB;
EOF

echo -e "${GREEN}✅ Database created${NC}\n"

echo -e "${YELLOW}📋 Phase 4: Creating Application Directory${NC}"

# Create app directory
mkdir -p /var/www/options-strategy-app
cd /var/www/options-strategy-app

echo -e "${GREEN}✅ Application directory created at /var/www/options-strategy-app${NC}\n"

echo -e "${YELLOW}📋 Phase 5: Installing PM2 (Process Manager)${NC}"

npm install -g pm2
echo -e "${GREEN}✅ PM2 installed${NC}\n"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           ✅ VPS PREREQUISITES COMPLETE!                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Clone repository:"
echo "   cd /var/www/options-strategy-app"
echo "   git clone https://github.com/YOUR_USERNAME/options-strategy-app.git ."
echo ""
echo "2. Configure backend:"
echo "   cd backend"
echo "   cp .env.example .env"
echo "   nano .env  # Edit with your API keys and passwords"
echo ""
echo "3. Install dependencies:"
echo "   npm install"
echo "   cd ../frontend && npm install"
echo ""
echo "4. Run migrations:"
echo "   cd backend && npm run migrations"
echo ""
echo "5. Build applications:"
echo "   cd backend && npm run build"
echo "   cd ../frontend && npm run build"
echo ""
echo "6. Start applications:"
echo "   cd /var/www/options-strategy-app"
echo "   pm2 start ecosystem.config.js"
echo ""
echo "7. Setup SSL and Nginx:"
echo "   certbot --nginx -d optionstrategy.rginvestor67.com"
echo ""

